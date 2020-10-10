import * as aribts from 'aribts';
import * as events from 'events';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as stream from 'stream';
import DateUtil from '../../../util/DateUtil';
import FileUtil from '../../../util/FileUtil';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IDropCheckerModel from './IDropCheckerModel';

@injectable()
class DropCheckerModel implements IDropCheckerModel {
    private log: ILogger;
    private listener: events.EventEmitter = new events.EventEmitter();
    private dest: string | null = null;
    private result: aribts.Result | null = null;
    private pidIndex: { [key: number]: string } = {};
    private time: Date | null = null;

    private transformStream: stream.Transform | null = null;
    private tsReadableConnector: aribts.TsReadableConnector | null = null;
    private tsPacketParser: aribts.TsPacketParser | null = null;
    private tsPacketAnalyzer: aribts.TsPacketAnalyzer | null = null;
    private tsSectionParser: aribts.TsSectionParser | null = null;
    private tsSectionAnalyzer: aribts.TsSectionAnalyzer | null = null;
    private tsSectionUpdater: aribts.TsSectionUpdater | null = null;
    private tsPacketSelector: aribts.TsPacketSelector | null = null;

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    /**
     * チェック開始
     * @param logDirPath: string ログファイル保存先ディレクトリパス
     * @param srcFilePath: string ソースファイル ログファイル名生成に使用する
     * @param stream: stream.Readable drop をチェックするストリーム
     * @return Promise<void>
     */
    public async start(logDirPath: string, srcFilePath: string, readableStream: stream.Readable): Promise<void> {
        this.dest = await this.getLogFilePath(logDirPath, srcFilePath);

        // 空ファイル生成
        await FileUtil.touchFile(this.dest);

        this.transformStream = new stream.Transform({
            transform: function (chunk: any, _encoding: string, done: () => void): void {
                this.push(chunk);
                done();
            },
            flush: function (done: () => void): void {
                done();
            },
        });

        this.tsReadableConnector = new aribts.TsReadableConnector();
        this.tsPacketParser = new aribts.TsPacketParser();
        this.tsPacketAnalyzer = new aribts.TsPacketAnalyzer();
        this.tsSectionParser = new aribts.TsSectionParser();
        this.tsSectionAnalyzer = new aribts.TsSectionAnalyzer();
        this.tsSectionUpdater = new aribts.TsSectionUpdater();
        this.tsPacketSelector = new aribts.TsPacketSelector({
            pids: new Array(0x30).fill(0).map((_, index) => index),
            programNumbers: [],
        });

        this.tsSectionUpdater.on('pmt', tsSection => {
            const streams = tsSection.decode().streams;
            for (const s of streams) {
                this.setIndex(s.stream_type, s.elementary_PID);
            }
        });

        let hasError = false;
        this.tsPacketAnalyzer.on('packetError', (pid, counter, expected) => {
            this.appendFile(
                `error: (pid: ${this.pidToString(pid)}, counter: ${counter || '-'}, expected: ${
                    expected || '-'
                }, time: ${this.getTime()})\n`,
            );
            hasError = true;
        });

        this.tsPacketAnalyzer.on('packetDrop', (pid, counter, expected) => {
            this.appendFile(
                `drop (pid: ${this.pidToString(pid)}, counter: ${counter || '-'}, expected: ${
                    expected || '-'
                }, time: ${this.getTime()})\n`,
            );
            hasError = true;
        });

        this.tsPacketAnalyzer.on('packetScrambling', pid => {
            this.appendFile(`scrambling (pid: ${this.pidToString(pid)}, time: ${this.getTime()})\n`);
            hasError = true;
        });

        this.tsPacketAnalyzer.on('finish', async () => {
            if (this.tsPacketAnalyzer === null) {
                return;
            }

            const result = this.tsPacketAnalyzer.getResult();
            this.result = result;
            this.listener.emit(DropCheckerModel.FINISH_EVENT);

            if (hasError) {
                await this.appendFile('\n');
            }
            for (const pid of Object.keys(result)) {
                const pidNum = parseInt(pid, 10);
                await this.appendFile(
                    `pid: ${this.pidToString(pidNum)}, error: ${result[pid as any].error}, drop: ${
                        result[pid as any].drop
                    }, scrambling: ${result[pid as any].scrambling}, packet: ${
                        result[pid as any].packet
                    }, name: ${this.getPIDName(pidNum)}\n`,
                );
            }
        });

        this.tsSectionAnalyzer.on('time', time => {
            this.time = time;
        });

        this.tsSectionParser.on('pmt', this.tsPacketSelector.onPmt.bind(this.tsPacketSelector));

        readableStream.pipe(this.transformStream);
        this.transformStream.pipe(this.tsReadableConnector);

        this.tsReadableConnector.pipe(this.tsPacketParser as any);
        this.tsPacketParser.pipe(this.tsPacketAnalyzer);
        this.tsPacketParser.pipe(this.tsSectionParser);
        this.tsPacketParser.pipe(this.tsPacketSelector);
        this.tsSectionParser.pipe(this.tsSectionAnalyzer);
        this.tsSectionParser.pipe(this.tsSectionUpdater);
    }

    /**
     * ログファイル保存先を取得する
     * @param logDirPath: string ログファイル保存先ディレクトリパス
     * @param srcFilePath: string ソースファイル ログファイル名生成に使用する
     * @param conflict: number 重複数
     * @return Promise<string>
     */
    private async getLogFilePath(logDirPath: string, srcFilePath: string, conflict: number = 0): Promise<string> {
        let filePath = path.join(logDirPath, path.basename(srcFilePath));
        if (conflict > 0) {
            filePath += `(${conflict})`;
        }
        filePath += '.log';

        // ディレクトリが存在するか確認
        try {
            await FileUtil.access(logDirPath, fs.constants.R_OK | fs.constants.W_OK);
        } catch (err) {
            if (typeof err.code !== 'undefined' && err.code === 'ENOENT') {
                // ディレクトリが存在しないので作成する
                this.log.system.info(`mkdirp: ${logDirPath}`);
                await FileUtil.mkdir(logDirPath);
            } else {
                // アクセス権に Read or Write が無い
                this.log.system.fatal(`dir permission error: ${logDirPath}`);
                this.log.system.fatal(err);
                throw err;
            }
        }

        // 同名のファイル名が存在するか確認
        try {
            await FileUtil.stat(filePath);

            return this.getLogFilePath(logDirPath, srcFilePath, conflict + 1);
        } catch (err) {
            return filePath;
        }
    }

    /**
     * set pid index
     * @param streamType: stream_type
     * @param pid: elementary_PID
     */
    private setIndex(streamType: number, pid: number): void {
        let name: string;

        switch (streamType) {
            case 0x00:
                name = 'ECM';
                break;
            case 0x02:
                name = 'MPEG2 VIDEO';
                break;
            case 0x04:
                name = 'MPEG2 AUDIO';
                break;
            case 0x06:
                name = '字幕';
                break;
            case 0x0d:
                name = 'データカルーセル';
                break;
            case 0x0f:
                name = 'MPEG2 AAC';
                break;
            case 0x1b:
                name = 'MPEG4 VIDEO';
                break;
            case 0x24:
                name = 'HEVC VIDEO';
                break;
            default:
                name = `stream_type 0x${('0000' + pid.toString(16)).slice(-4)}`;
                break;
        }

        this.pidIndex[pid] = name;
    }

    /**
     * log 追記
     * @param str
     * @return Promise<void>
     */
    private async appendFile(str: string): Promise<void> {
        if (this.dest === null) {
            throw new Error('LogFilePathIsNull');
        }

        await FileUtil.appendFile(this.dest, str);
    }

    /**
     * pid を文字列に変換
     * @param pid: number
     * @return string
     */
    private pidToString(pid: number): string {
        return '0x' + `${('000' + pid.toString(16)).slice(-4)}`.toUpperCase();
    }

    /**
     * get time
     * @return string
     */
    private getTime(): string {
        return this.time === null ? '-' : DateUtil.format(this.time, 'yyyy/MM/dd hh:mm:ss');
    }

    /**
     * get pid name
     * @param pid: number
     * @return string
     */
    private getPIDName(pid: number): string {
        let name: string;

        switch (pid) {
            case 0x0000:
                name = 'PAT';
                break;
            case 0x0001:
                name = 'CAT';
                break;
            case 0x0010:
                name = 'NIT';
                break;
            case 0x0011:
                name = 'SDT/BAT';
                break;
            case 0x0012:
            case 0x0026:
            case 0x0027:
                name = 'EIT';
                break;
            case 0x0013:
                name = 'RST';
                break;
            case 0x0014:
                name = 'TDT/TOT';
                break;
            case 0x0017:
                name = 'DCT';
                break;
            case 0x001e:
                name = 'DIT';
                break;
            case 0x001f:
                name = 'SIT';
                break;
            case 0x0020:
                name = 'LIT';
                break;
            case 0x0021:
                name = 'ERT';
                break;
            case 0x0022:
                name = 'PCAT';
                break;
            case 0x0023:
            case 0x0028:
                name = 'SDTT';
                break;
            case 0x0024:
                name = 'BIT';
                break;
            case 0x0025:
                name = 'NBIT/LDT';
                break;
            case 0x0029:
                name = 'CDT';
                break;
            case 0x1fff:
                name = 'NULL';
                break;
            default:
                // eslint-disable-next-line no-case-declarations
                const n = this.pidIndex[pid];
                name = typeof n === 'undefined' ? '-' : n;
                break;
        }

        return name;
    }

    /**
     * 削除
     */
    public async stop(): Promise<void> {
        this.log.system.info(`stop drop check: ${this.dest}`);

        if (this.tsSectionParser !== null) {
            this.tsSectionParser.removeAllListeners();
        }

        if (this.transformStream !== null) {
            this.transformStream.unpipe();
        }

        if (this.tsReadableConnector !== null) {
            this.tsReadableConnector.removeAllListeners();
        }

        if (this.tsPacketParser !== null) {
            this.tsPacketParser.removeAllListeners();
        }

        this.transformStream = null;
        this.tsReadableConnector = null;
        this.tsPacketParser = null;
        this.tsPacketAnalyzer = null;
        this.tsSectionParser = null;
        this.tsSectionAnalyzer = null;
        this.tsSectionUpdater = null;
        this.tsPacketSelector = null;
    }

    /**
     * ログファイルパス返す
     * @return string | null
     */
    public getFilePath(): string | null {
        return this.dest;
    }

    /**
     * 結果の取得
     * @return Promise<aribts.Result>
     */
    public async getResult(): Promise<aribts.Result> {
        if (this.dest === null) {
            throw new Error('DestIsNull');
        }

        await this.setResult();
        if (this.result === null) {
            throw new Error('GetDropResultError');
        }

        return this.result;
    }

    /**
     * finish を待って結果を result へ格納する
     */
    private setResult(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.result !== null) {
                resolve();
            } else {
                this.listener.once(DropCheckerModel.FINISH_EVENT, () => {
                    resolve();
                });

                setTimeout(() => {
                    this.listener.removeAllListeners();
                    reject(new Error('GetResultTimeout'));
                }, 10 * 1000);
            }
        });
    }
}

namespace DropCheckerModel {
    export const FINISH_EVENT = 'finish_event';
}

export default DropCheckerModel;
