import * as path from 'path';
import type Recorded from '../db/entities/Recorded.js';
import type VideoFile from '../db/entities/VideoFile.js';
import type IVideoUtil from './api/video/IVideoUtil.js';
import type IRecordedDB from './db/IRecordedDB.js';
import type { EncodeQueueRecord } from './operator/encode/IEncodeQueueStore.js';
import type { ServiceChildProcessEntry } from './ServiceChildProcessRegistry.js';
import type { ProcessSystem } from './ServiceChildProcessSystem.js';
import { PROCESS_STOP_CHECK_INTERVAL_MS, StopSignal, stopInStages } from './service/encode/EncodeProcessManageModel.js';

/** 終了から後始末の完了までを待つ上限（ミリ秒）。超えたら待たずに使用権を解放して再起動へ進む。 */
export const SERVICE_CHILD_CLEANUP_CAP_MS = 30_000;

/** 出力の削除の判定に使う、録画済み番組と録画ファイルの読取り（起動時の復元と同じもの）。 */
export interface ServiceChildRecordedFiles {
    readonly recordedDB: Pick<IRecordedDB, 'findId'>;
    readonly videoUtil: Pick<IVideoUtil, 'getFullFilePathFromVideoFile' | 'getParentDirPath'>;
}

/** `ServiceChildTerminationCleanup` が使う協力者と設定。 */
export interface ServiceChildTerminationCleanupDependencies {
    /** 終了した世代の外部プロセスの記録 */
    readonly processes: { takeEntries(peer: object): Promise<readonly ServiceChildProcessEntry[]> };
    /** 録画の使用権の記録 */
    readonly recordedUse: { releasePeer(peer: object): void };
    /** エンコードの依頼の記録（出力先を読む） */
    readonly encodeQueue: { list(): Promise<EncodeQueueRecord[]> };
    /** 録画済み番組と録画ファイルの読取りを取り出す（使うときに取り出し、失敗は記録して出力を残す） */
    readonly resolveRecordedFiles: () => ServiceChildRecordedFiles;
    /** 二つの path が同じ実体のファイルを指すか（起動時の復元と同じ判定） */
    readonly isSameFile: (a: string, b: string) => Promise<boolean>;
    /** HLS 保存先の HLS 成果物の削除 */
    readonly hlsArtifacts: { deleteAllArtifacts(streamFilePath: string, isCancelled: () => boolean): Promise<unknown> };
    /** HLS 保存先 */
    readonly streamFilePath: string;
    /** `encodeRemoveInterruptedOutput`（省略時は有効） */
    readonly removeInterruptedOutput: boolean;
    /** OS の操作 */
    readonly system: ProcessSystem;
    /** 記録先 */
    readonly logger: { error(value: unknown): void; info(value: unknown): void };
}

interface StopOutcome {
    readonly entry: ServiceChildProcessEntry;
    readonly wasRunning: boolean;
    readonly exitConfirmed: boolean;
}

interface CleanupState {
    cancelled: boolean;
}

/**
 * 管理側（親 process）で、Web・API 側処理（子 process）が終了したときに、その世代が開始した外部プロセスを
 * 種別ごとの通常の停止と同じ方法で止め、終了を確かめられないものは居なくなるまで待ち、出力途中のエンコード出力と
 * HLS 成果物を削除し、録画の使用権を解放する。全体を `SERVICE_CHILD_CLEANUP_CAP_MS` で打ち切り、`run` は失敗しても
 * reject しない。
 */
export default class ServiceChildTerminationCleanup {
    constructor(
        private readonly deps: ServiceChildTerminationCleanupDependencies,
        private readonly capMilliseconds: number = SERVICE_CHILD_CLEANUP_CAP_MS,
    ) {}

    /**
     * 終了した世代の後始末をする。後始末を終えたとき、失敗したとき、または上限に達したときに、使用権を一回だけ解放して
     * 戻る。上限に達したときはその旨を記録し、それ以後は残りの後始末でファイルを削除しない。
     * @param peer 終了した Web・API 側処理
     */
    public async run(peer: object): Promise<void> {
        const state: CleanupState = { cancelled: false };
        let timer: NodeJS.Timeout | undefined;
        try {
            const cap = new Promise<'cap'>(resolve => {
                timer = setTimeout(() => resolve('cap'), this.capMilliseconds);
            });
            const outcome = await Promise.race([this.cleanUp(peer, state).then(() => 'done' as const), cap]);
            if (outcome === 'cap') {
                this.deps.logger.error(
                    `service child cleanup did not finish within ${this.capMilliseconds} ms; the service is restarted without waiting`,
                );
            }
        } catch (error: unknown) {
            this.deps.logger.error('service child cleanup failed');
            this.deps.logger.error(error);
        } finally {
            state.cancelled = true;
            clearTimeout(timer);
            this.releaseLeases(peer);
        }
    }

    private releaseLeases(peer: object): void {
        try {
            this.deps.recordedUse.releasePeer(peer);
        } catch (error: unknown) {
            this.deps.logger.error('failed to release the recorded-use leases of the ended service child');
            this.deps.logger.error(error);
        }
    }

    private async cleanUp(peer: object, state: CleanupState): Promise<void> {
        const entries = await this.deps.processes.takeEntries(peer);
        const outcomes = await Promise.all(entries.map(entry => this.stop(entry)));
        await this.waitUntilGone(
            outcomes.filter(outcome => outcome.wasRunning && !outcome.exitConfirmed).map(outcome => outcome.entry),
            state,
        );
        await this.deleteInterruptedOutputs(outcomes, state);
        await this.deleteHlsArtifacts(state);
    }

    /**
     * 停止の確認の回数を使い切っても終了を確かめられなかった process を、追加の signal を送らず、同じ確認の方法で
     * `PROCESS_STOP_CHECK_INTERVAL_MS` ごとに確かめ、すべて居なくなるか上限に達するまで待つ。
     * @param entries 終了を確かめられなかった process
     * @param state 上限に達したかの状態
     */
    private async waitUntilGone(entries: readonly ServiceChildProcessEntry[], state: CleanupState): Promise<void> {
        let remaining = entries;
        while (remaining.length > 0 && !state.cancelled) {
            await this.deps.system.wait(PROCESS_STOP_CHECK_INTERVAL_MS);
            remaining = remaining.filter(entry => this.isSameProcessAlive(entry, 'after-stop-check') !== false);
        }
    }

    /**
     * 外部プロセス一件を、種別ごとの通常の停止と同じ方法で止める。エンコードと非 HLS 配信は PID へ `SIGINT` だけを
     * 送り、HLS writer は process group へ `SIGINT`、終わらなければ `SIGKILL` を送る。
     * @param entry 止める外部プロセス
     * @returns 停止を始めた時点で動いていたかと、終了を確かめられたか
     */
    private async stop(entry: ServiceChildProcessEntry): Promise<StopOutcome> {
        const signals: readonly StopSignal[] = entry.kind === 'hls' ? ['SIGINT', 'SIGKILL'] : ['SIGINT'];
        const result = await stopInStages(signals, {
            isAlive: stage => this.isSameProcessAlive(entry, stage),
            send: signal => this.send(entry, signal),
            wait: async () => {
                await this.deps.system.wait(PROCESS_STOP_CHECK_INTERVAL_MS);
                return true;
            },
            isSettled: () => false,
        });
        if (!result.exitConfirmed) {
            this.deps.logger.error({
                kind: entry.kind,
                pgid: entry.pgid,
                pid: entry.pid,
                sentSignals: result.sentSignals,
                terminalConfirmed: false,
            });
        }
        return { entry, exitConfirmed: result.exitConfirmed, wasRunning: result.wasRunning };
    }

    /**
     * 開始の知らせを受け取ったときと同じ process（HLS writer はその process group）がまだ居るかを確かめる。
     * 開始時刻が変わった PID と終了済み（zombie）の process は居ないとみなす。HLS writer の group は、leader の開始時刻が
     * 違えば居ないとみなし、一致して動いていれば居るとみなす。leader が zombie・居ない・開始時刻を読めないときだけ、終了済み
     * でない member が居るかで確かめる（zombie だけの group は終了）。
     * 開始時刻や group の member を読めないときは PID・PGID だけで確かめる。確かめる操作が失敗したら記録して
     * `undefined` を返す（居なくなったとはみなさない）。
     */
    private isSameProcessAlive(entry: ServiceChildProcessEntry, stage: string): boolean | undefined {
        try {
            if (entry.kind === 'hls') {
                const leader = this.deps.system.identify(entry.pgid!);
                if (leader.status === 'running' && entry.startTime !== null) {
                    // 開始時刻が一致して動いている leader は group の生きた member。違えば元の group は居ない。
                    return leader.startTime === entry.startTime;
                }
                return this.deps.system.hasLiveGroupMember(entry.pgid!) ?? this.deps.system.isGroupAlive(entry.pgid!);
            }
            const identity = this.deps.system.identify(entry.pid);
            switch (identity.status) {
                case 'running':
                    return entry.startTime === null || identity.startTime === entry.startTime;
                case 'unavailable':
                    return this.deps.system.isAlive(entry.pid);
                default:
                    return false;
            }
        } catch (error: unknown) {
            this.deps.logger.error({ error, kind: entry.kind, pgid: entry.pgid, pid: entry.pid, stage });
            return undefined;
        }
    }

    private send(entry: ServiceChildProcessEntry, signal: StopSignal): boolean {
        try {
            if (entry.kind === 'hls') {
                this.deps.system.signalGroup(entry.pgid!, signal);
            } else {
                this.deps.system.signal(entry.pid, signal);
            }
            return true;
        } catch (error: unknown) {
            this.deps.logger.error({
                error,
                kind: entry.kind,
                pgid: entry.pgid,
                pid: entry.pid,
                stage: `${signal}-send`,
            });
            return false;
        }
    }

    /**
     * 停止を始めた時点で動いていたエンコードの出力途中のファイルを、起動時の復元と同じ規則に当てはまるときだけ削除する。
     * 上限に達した後は削除しない。
     */
    private async deleteInterruptedOutputs(outcomes: readonly StopOutcome[], state: CleanupState): Promise<void> {
        const encodeIds = outcomes
            .filter(outcome => outcome.wasRunning && outcome.entry.kind === 'encode')
            .map(outcome => outcome.entry.encodeId!);
        if (encodeIds.length === 0 || this.deps.removeInterruptedOutput === false) return;

        let records: EncodeQueueRecord[];
        try {
            records = await this.deps.encodeQueue.list();
        } catch (error: unknown) {
            this.deps.logger.error('failed to read the encode request records of the ended service child');
            this.deps.logger.error(error);
            return;
        }
        for (const encodeId of encodeIds) {
            const record = records.find(item => item.id === encodeId);
            if (record === undefined || record.outputPath === null) continue;
            const outputPath = record.outputPath;
            if ((await this.isDeletableOutput(record, outputPath)) === false) continue;
            if (state.cancelled) return;
            try {
                await this.deps.system.removeFile(outputPath);
                this.deps.logger.info(
                    `deleted the interrupted encode output of the ended service child: ${outputPath}`,
                );
            } catch (error: unknown) {
                this.deps.logger.error(`failed to delete the interrupted encode output: ${outputPath}`);
                this.deps.logger.error(error);
            }
        }
    }

    /**
     * 出力途中のファイルを起動時の復元と同じ規則で削除してよいかを判定する。録画済み番組と変換元ファイルが在り、出力先が
     * 録画ファイルとして登録されておらず（full path の一致と同じ実体の判定）、出力先が依頼の親保存先の中を指すときだけ
     * 削除してよい。読取りに失敗したら削除しない。
     */
    private async isDeletableOutput(record: EncodeQueueRecord, outputPath: string): Promise<boolean> {
        let files: ServiceChildRecordedFiles;
        let recorded: Recorded | null;
        try {
            files = this.deps.resolveRecordedFiles();
            recorded = await files.recordedDB.findId(record.option.recordedId);
        } catch (error: unknown) {
            this.deps.logger.error(
                `failed to read the recorded program of the interrupted encode output: ${record.id}`,
            );
            this.deps.logger.error(error);
            return false;
        }
        const videoFiles: VideoFile[] = recorded?.videoFiles ?? [];
        if (videoFiles.some(file => file.id === record.option.sourceVideoFileId) === false) {
            this.deps.logger.info(
                `interrupted encode output is kept because the recorded program or the source file is missing: ${record.id}`,
            );
            return false;
        }
        for (const file of videoFiles) {
            const registeredPath = files.videoUtil.getFullFilePathFromVideoFile(file);
            if (registeredPath === null) continue;
            if (
                path.resolve(registeredPath) === path.resolve(outputPath) ||
                (await this.deps.isSameFile(registeredPath, outputPath))
            ) {
                this.deps.logger.info(`interrupted encode output is a registered recorded file: ${record.id}`);
                return false;
            }
        }
        if (this.isInsideParentDirectory(files.videoUtil.getParentDirPath(record.option.parentDir), outputPath)) {
            return true;
        }
        this.deps.logger.info(
            `interrupted encode output is kept because it is outside the parent directory: ${record.id}`,
        );
        return false;
    }

    private isInsideParentDirectory(parentDirPath: string | null, outputPath: string): boolean {
        if (parentDirPath === null) return false;
        const relative = path.relative(path.resolve(parentDirPath), path.resolve(outputPath));
        return relative !== '' && relative.startsWith('..') === false && path.isAbsolute(relative) === false;
    }

    private async deleteHlsArtifacts(state: CleanupState): Promise<void> {
        if (state.cancelled) return;
        try {
            await this.deps.hlsArtifacts.deleteAllArtifacts(this.deps.streamFilePath, () => state.cancelled);
        } catch (error: unknown) {
            this.deps.logger.error(
                `failed to delete the HLS artifacts of the ended service child: ${this.deps.streamFilePath}`,
            );
            this.deps.logger.error(error);
        }
    }
}
