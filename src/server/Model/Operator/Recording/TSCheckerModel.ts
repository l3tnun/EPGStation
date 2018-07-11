/// <reference path="./aribts.d.ts" />

import * as aribts from 'aribts';
import * as events from 'events';
import * as stream from 'stream';
import Model from '../../Model';

interface DropLog {
    [pid: number]: DropLogItem;
}

interface DropLogItem extends aribts.ResultItem {
    name: string;
}

interface TSCheckerModelInterface extends Model {
    set(readableStream: stream.Readable): void;
    getResult(): Promise<DropLog>;
}

class TSCheckerModel extends Model implements TSCheckerModelInterface {
    private listener: events.EventEmitter = new events.EventEmitter();
    private result: aribts.Result | null = null;
    private pidIndex: { [key: number]: string } = {};

    public set(readableStream: stream.Readable): void {
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

        tsPacketAnalyzer.on('finish', () => {
            const result = tsPacketAnalyzer.getResult();
            this.result = result;
            this.listener.emit(TSCheckerModel.FinishEvent, result);
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
     * 結果の取得
     */
    public async getResult(): Promise<DropLog> {
        await this.setResult();
        if (this.result === null) {
            throw new Error('GetDropResultError');
        }

        const result: DropLog = {};

        // name 追加
        for (const key in this.result) {
            result[key] = <DropLogItem> this.result[key];
            result[key].name = this.getPIDName(parseInt(key, 10));
        }

        return result;
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
}

namespace TSCheckerModel {
    export const FinishEvent = 'Finish';
}

export { DropLog, DropLogItem, TSCheckerModelInterface, TSCheckerModel };

