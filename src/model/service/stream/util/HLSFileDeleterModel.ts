import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import FileUtil from '../../../../util/FileUtil.js';
import ILogger from '../../../ILogger.js';
import ILoggerModel from '../../../ILoggerModel.js';
import IHLSFileDeleterModel, { HLSFileDeleterOption, HlsArtifactCleanupResult } from './IHLSFileDeleterModel.js';

const DELETE_PASS_COUNT = 3;

/**
 * `IHLSFileDeleterModel` の実装。ディスク上の HLS artifact（セグメント・プレイリスト
 * ファイル）の削除・走査を行う。削除は他プロセス（配信用の encode process 等）による
 * 書き込みと競合しうるため、`deleteAllFiles` は一度の削除で終わらせず、削除→再走査を
 * `DELETE_PASS_COUNT` 回まで繰り返して残存を減らそうとする。
 */
@injectable()
export default class HLSFileDeleterModel implements IHLSFileDeleterModel {
    private log: ILogger;
    /** `setOption` で設定された既定 option。`deleteAllFiles` に明示 option が渡されない場合に使う。 */
    private option: HLSFileDeleterOption | null = null;

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    /**
     * 削除オプション設定
     * @param option: HLSFileDeleterOption
     */
    public setOption(option: HLSFileDeleterOption): void {
        this.option = option;
    }

    /**
     * `IStreamIdAllocator`（`HlsStreamIdAllocator`）がプロセス起動時に一度だけ行う走査。
     * 実装は `scanCurrent` と同一だが、呼び出し側の意図（起動時の初期状態把握か、
     * 都度のスナップショット取得か）を型で区別できるよう method を分けている。
     */
    public async scanAtStartup(streamFilePath: string): Promise<ReadonlySet<number>> {
        return this.scan(streamFilePath);
    }

    /**
     * 現時点でディスク上に存在する HLS artifact の streamId 集合を返す。
     */
    public async scanCurrent(streamFilePath: string): Promise<ReadonlySet<number>> {
        return this.scan(streamFilePath);
    }

    /**
     * 指定した streamId ちょうどの artifact ファイル名だけを列挙する（他の streamId の
     * ファイルは含まない）。
     */
    public async listExact(streamFilePath: string, streamId: number): Promise<string[]> {
        const files = await FileUtil.readDir(streamFilePath);
        return files.filter(file => this.isHlsArtifactForStream(file, streamId));
    }

    /**
     * 全てのファイルを削除する
     */
    public async deleteAllFiles(explicitOption?: HLSFileDeleterOption): Promise<HlsArtifactCleanupResult> {
        const option = explicitOption ?? this.option;
        if (option === null) {
            throw new Error('HLSFileDeleterOptionIsNull');
        }

        this.logStream('info', `delete all hls files: ${option.streamId}`);
        let hasUnknownArtifactState = false;
        let remainingFiles: string[] = [];
        for (let pass = 1; pass <= DELETE_PASS_COUNT; pass++) {
            try {
                await this.scanCurrent(option.streamFilePath);
            } catch (error: unknown) {
                hasUnknownArtifactState = true;
                this.logStream('error', { error, operation: 'scan', pass, streamId: option.streamId });
            }

            const files = await this.listArtifacts(option, pass, 'list');
            if (files === null) {
                hasUnknownArtifactState = true;
            } else {
                for (const file of files.sort()) {
                    await this.deleteArtifact(option, file, pass);
                }
            }

            const rescanned = await this.listArtifacts(option, pass, 'rescan');
            if (rescanned === null) {
                hasUnknownArtifactState = true;
                continue;
            }
            remainingFiles = rescanned.sort();
            if (remainingFiles.length === 0 && hasUnknownArtifactState === false) {
                return { passes: pass, remainingFiles, status: 'cleared' };
            }
        }

        return {
            passes: DELETE_PASS_COUNT,
            remainingFiles,
            status: hasUnknownArtifactState ? 'unknown' : 'remaining',
        };
    }

    private async listArtifacts(
        option: HLSFileDeleterOption,
        pass: number,
        operation: 'list' | 'rescan',
    ): Promise<string[] | null> {
        try {
            return await this.listExact(option.streamFilePath, option.streamId);
        } catch (error: unknown) {
            this.logStream('error', { error, operation, pass, streamId: option.streamId });
            return null;
        }
    }

    private async deleteArtifact(option: HLSFileDeleterOption, file: string, pass: number): Promise<void> {
        try {
            await FileUtil.unlink(`${option.streamFilePath}/${file}`);
            this.logStream('info', `deleted ${file}`);
        } catch (error: unknown) {
            this.logStream('error', { error, file, operation: 'unlink', pass, streamId: option.streamId });
        }
    }

    private async scan(streamFilePath: string): Promise<ReadonlySet<number>> {
        await this.prepareDirectory(streamFilePath);
        const files = await FileUtil.readDir(streamFilePath);
        const ids = new Set<number>();
        for (const file of files) {
            const match = /^stream(\d+)/.exec(file);
            if (match === null) {
                continue;
            }

            const id = Number(match[1]);
            if (Number.isSafeInteger(id) && this.isHlsArtifactForStream(file, id)) {
                ids.add(id);
            }
        }

        return ids;
    }

    private async prepareDirectory(streamFilePath: string): Promise<void> {
        try {
            await FileUtil.access(streamFilePath, fs.constants.R_OK | fs.constants.W_OK);
        } catch (error: unknown) {
            if (this.isMissingDirectory(error) === false) {
                throw error;
            }

            await FileUtil.mkdir(streamFilePath);
            await FileUtil.access(streamFilePath, fs.constants.R_OK | fs.constants.W_OK);
        }
    }

    /**
     * ファイル名が指定 streamId の artifact（`stream<ID>.m3u8`、`stream<ID>-child_vtt.m3u8` 等）
     * かどうかを判定する。`stream1` のファイルが `stream10` に誤って一致しないよう、
     * prefix の直後の文字が数字でないことまで確認する。
     */
    private isHlsArtifactForStream(file: string, streamId: number): boolean {
        const prefix = `stream${streamId}`;
        const suffix = file.slice(prefix.length);
        return suffix.length > 0 && file.startsWith(prefix) && /[0-9]/u.test(suffix.charAt(0)) === false;
    }

    private logStream(method: 'error' | 'info', value: unknown): void {
        try {
            if (method === 'error') {
                this.log.stream.error(value);
                return;
            }
            this.log.stream.info(value);
        } catch {
            // Diagnostics must not interrupt later artifact cleanup or its result.
        }
    }

    private isMissingDirectory(error: unknown): boolean {
        return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
    }
}
