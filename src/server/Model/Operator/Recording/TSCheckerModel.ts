/// <reference path="./aribts.d.ts" />

import * as aribts from 'aribts';
import * as events from 'events';
import * as fs from 'fs';
import * as stream from 'stream';
import FileUtil from '../../../Util/FileUtil';
import Model from '../../Model';

interface TSCheckerModelInterface extends Model {
    set(tsPath: string, readableStream: stream.Readable): Promise<void>;
    getFilePath(): string | null;
    getResult(): Promise<aribts.Result>;
    setDeleted(): void;
}

class TSCheckerModel extends Model implements TSCheckerModelInterface {
    private listener: events.EventEmitter = new events.EventEmitter();
    private logPath: string | null = null;
    private isDeleted: boolean = false;
    private result: aribts.Result | null = null;
    private pidIndex: { [key: number]: string } = {};
    private time: Date | null = null;

    public async set(tsPath: string, readableStream: stream.Readable): Promise<void> {
        this.logPath = this.getLogPath(tsPath);

        // 空ファイル生成
        await FileUtil.touchFile(this.logPath);

        const transformStream = new stream.Transform({
            // tslint:disable-next-line:space-before-function-paren
            transform: function (chunk: any, _encoding: string, done: () => void): void {
                // tslint:disable-next-line
                (<any> this).push(chunk);
                done();
            },
            // tslint:disable-next-line:space-before-function-paren only-arrow-functions
            flush: function (done: () => void): void {
                done();
            },
        });

        const tsReadableConnector = new aribts.TsReadableConnector();
        const tsPacketParser = new aribts.TsPacketParser();
        const tsPacketAnalyzer = new aribts.TsPacketAnalyzer();
        const tsSectionParser = new aribts.TsSectionParser();
        const tsSectionAnalyzer = new aribts.TsSectionAnalyzer();
        const tsSectionUpdater = new aribts.TsSectionUpdater();
        const tsPacketSelector = new aribts.TsPacketSelector({
            pids: new Array(0x30).fill(0).map((_, index) => index),
            programNumbers: [],
        });

        tsSectionUpdater.on('pmt', tsSection => {
            const streams = tsSection.decode().streams;
            for (const s of streams) {
                this.setIndex(s.stream_type, s.elementary_PID);
            }
        });

        let hasError = false;
        tsPacketAnalyzer.on('packetError', (pid, counter, expected) => {
            this.appendFile(`error: (pid: ${ this.pidToString(pid) }, counter: ${ counter || '-' }, expected: ${ expected || '-' }, time: ${ this.getTime() })\n`);
            hasError = true;
        });

        tsPacketAnalyzer.on('packetDrop', (pid, counter, expected) => {
            this.appendFile(`drop (pid: ${ this.pidToString(pid) }, counter: ${ counter || '-' }, expected: ${ expected || '-' }, time: ${ this.getTime() })\n`);
            hasError = true;
        });

        tsPacketAnalyzer.on('packetScrambling', (pid) => {
            this.appendFile(`scrambling (pid: ${ this.pidToString(pid) }, time: ${ this.getTime() })\n`);
            hasError = true;
        });

        tsPacketAnalyzer.on('finish', async() => {
            const result = tsPacketAnalyzer.getResult();
            this.result = result;
            this.listener.emit(TSCheckerModel.FinishEvent, result);

            if (this.isDeleted) { return; }

            if (hasError) {
                await this.appendFile('\n');
            }
            for (const pid of Object.keys(result)) {
                const pidNum = parseInt(pid, 10);
                await this.appendFile(`pid: ${ this.pidToString(pidNum) }, error: ${ result[pid].error }, drop: ${ result[pid].drop }, scrambling: ${ result[pid].drop }, packet: ${ result[pid].packet }, name: ${ this.getPIDName(pidNum) }\n`);
            }
        });

        tsSectionAnalyzer.on('time', (time) => {
            this.time = time;
        });

        tsSectionParser.on('pmt', tsPacketSelector.onPmt.bind(tsPacketSelector));

        readableStream.pipe(transformStream);
        transformStream.pipe(tsReadableConnector);

        tsReadableConnector.pipe(<any> tsPacketParser);
        tsPacketParser.pipe(tsPacketAnalyzer);
        tsPacketParser.pipe(tsSectionParser);
        tsPacketParser.pipe(tsPacketSelector);
        tsSectionParser.pipe(tsSectionAnalyzer);
        tsSectionParser.pipe(tsSectionUpdater);
    }

    /**
     * log file path を返す
     * @param tsPath: ts file path
     * @param conflict: number
     * @return string
     */
    private getLogPath(tsPath: string, conflict: number = 0): string {
        let filePath = tsPath;
        if (conflict > 0) { filePath += `(${ conflict })`; }
        filePath += '.log';

        // 同名ファイルが存在するか確認
        try {
            fs.statSync(filePath);

            return this.getLogPath(tsPath, conflict + 1);
        } catch (err) {
            return filePath;
        }
    }

    /**
     * log 追記
     * @param str
     * @return Promise<void>
     */
    private async appendFile(str: string): Promise <void> {
        if (this.logPath === null) {
            throw new Error('LogFilePathIsNull');
        }

        if (this.isDeleted) {
            this.log.system.warn(`log file is deleted: ${ this.logPath }`);

            return;
        }

        return new Promise<void>((resolve: () => void, reject: (error: Error) => void) => {
            fs.appendFile(this.logPath!, str, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * pid を文字列に変換
     * @param pid: number
     * @return string
     */
    private pidToString(pid: number): string {
        return `0x${ ('000' + pid.toString(16)).slice(-4) }`;
    }

    /**
     * get time
     * @return string
     */
    private getTime(): string {
        return this.time === null ? '-' : `${ this.time.getTime() }`;
    }

    /**
     * set pid index
     * @param streamType: stream_type
     * @param pid: elementary_PID
     */
    public setIndex(streamType: number, pid: number): void {
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
            case 0x0D:
                name = 'データカルーセル';
                break;
            case 0x0F:
                name = 'MPEG2 AAC';
                break;
            case 0x1B:
                name = 'MPEG4 VIDEO';
                break;
            case 0x24:
                name = 'HEVC VIDEO';
                break;
            default:
                name = `stream_type 0x${ ('0000' + pid.toString(16)).slice(-4) }`;
                break;
        }

        this.pidIndex[pid] = name;
    }

    /**
     * ログのファイルパス取得
     * @return string | null
     */
    public getFilePath(): string | null {
        return this.logPath;
    }

    /**
     * 結果の取得
     */
    public async getResult(): Promise<aribts.Result> {
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
        return new Promise<void>((resolve: () => void) => {
            if (this.result !== null) {
                resolve();
            } else {
                this.listener.on(TSCheckerModel.FinishEvent, (result: aribts.Result) => {
                    this.result = result;
                    resolve();
                });
            }
        });
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
            case 0x001E:
                name = 'DIT';
                break;
            case 0x001F:
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
            case 0x1FFF:
                name = 'NULL';
                break;
            default:
                const n = this.pidIndex[pid];
                name = typeof n === 'undefined' ? '-' : n;
                break;
        }

        return name;
    }

    /**
     * ts ファイルが削除されたことをセット
     */
    public setDeleted(): void {
        this.isDeleted = true;
    }
}

namespace TSCheckerModel {
    export const FinishEvent = 'Finish';
}

export { TSCheckerModelInterface, TSCheckerModel };

