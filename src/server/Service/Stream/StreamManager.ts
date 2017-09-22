import * as fs from 'fs';
import Base from '../../Base';
import { Stream } from './Stream';
import StreamStatus from './StreamStatus';
import * as enums from './StreamTypeInterface';
import * as apid from '../../../../api';
import { MpegTsLiveStreamInfo } from './MpegTsLiveStream';
import { RecordedHLSStreamInfo } from './RecordedHLSStream';
import SocketIoServer from '../SocketIoServer';
import Util from '../../Util/Util';

/**
* Stream 情報
* StreamInfo と StreamStatus から生成される
*/
interface StreamStatusInfo {
    streamNumber: number;
    isEnable: boolean; //視聴可能か
    viewCnt: number; //視聴数 (HLS では変動しない)
    isNull: boolean, // stream が null の場合
    type?: enums.StreamType,
    channelId?: apid.ServiceItemId, // MpegTsLive 固有の情報
    recordedId?: apid.RecordedId,  // RecordedHLS 固有の情報
    mode?: number, // config の index number
}

interface StreamManagerInterface {
    getStreamInfo(num: number): StreamStatusInfo | null;
    getStreamInfos(): StreamStatusInfo[];
    getStream(streamNumber: number): Stream | null;
    start(stream: Stream): Promise<number>;
    stop(streamNumber: number): Promise<void>;
    forcedStopAll(): Promise<void>;
}

/**
* StreamManager
* Stream の管理を行う
*/
class StreamManager extends Base implements StreamManagerInterface {
    private static instance: StreamManager;

    private maxStreaming: number;
    private streamStatus: { [key: number]: StreamStatus } = {};

    public static getInstance(): StreamManager {
        if(!this.instance) {
            this.instance = new StreamManager();
        }

        return this.instance;
    }

    private constructor() {
        super();

        // エンコード数上限を取得
        this.maxStreaming = this.config.getConfig().maxStreaming || 0;
    }

    /**
    * Stream 情報を取得
    * @param num: stream number
    * @return StreamStatusInfo
    */
    public getStreamInfo(num: number): StreamStatusInfo | null {
        if(typeof this.streamStatus[num] === 'undefined' || this.streamStatus[num].stream === null) { return null; }

        let stream = this.streamStatus[num].stream!;
        let streamInfo = stream.getInfo();

        let result: StreamStatusInfo =  {
            streamNumber: num,
            isEnable: this.streamStatus[num].isEnable,
            viewCnt: stream.getCount(),
            isNull: false,
            type: streamInfo.type,
            mode: streamInfo.mode,
        };

        if(streamInfo.type === 'MpegTsLive') { result.channelId = (<MpegTsLiveStreamInfo>streamInfo).channelId; }
        if(streamInfo.type === 'RecordedHLS') { result.recordedId = (<RecordedHLSStreamInfo>streamInfo).recordedId; }

        return result;
    }

    /**
    * すべての Stream 情報を取得
    * @return StreamStatusInfo[]
    */
    public getStreamInfos(): StreamStatusInfo[] {
        let results: StreamStatusInfo[] = [];
        for(let i = 0; i < this.maxStreaming; i++) {
            if(typeof this.streamStatus[i] === 'undefined') { continue; }
            let result = this.getStreamInfo(i);
            if(result === null) {
                results.push({
                    streamNumber: i,
                    isEnable: false,
                    viewCnt: 0,
                    isNull: true,
                });
            } else {
                results.push(result);
            }
        }

        return results;
    }

    /**
    * Stream を取得
    * @param streamNumber: stream number
    * @return Stream | null
    */
    public getStream(streamNumber: number): Stream | null {
        return typeof this.streamStatus[streamNumber] === 'undefined' ? null : this.streamStatus[streamNumber].stream;
    }

    /**
    * ストリームの開始
    * @param stream: Stream
    * @return streamNumber
    */
    public async start(stream: Stream): Promise<number> {
        let streamNumber = this.getEmptyStreamNumber();
        if(streamNumber === null || typeof this.streamStatus[streamNumber] !== 'undefined') { throw new Error('StartStreamError'); }

        this.streamStatus[streamNumber] = new StreamStatus();

        try {
            await this.runStream(streamNumber, stream);
            return streamNumber;
        } catch(err) {
            this.log.stream.error('start stream error');
            this.log.stream.error(err.message);
            throw err;
        }
    }

    /**
    * ストリームを停止
    * @param streamNumber: stream number
    */
    public async stop(streamNumber: number): Promise<void> {
        if(typeof this.streamStatus[streamNumber] === 'undefined' || this.streamStatus[streamNumber].stream === null) {
            return;
        }

        let stream = this.streamStatus[streamNumber].stream!;

        //カウントが 0 なら停止
        if(stream.getCount() > 0) { return; }
        delete this.streamStatus[streamNumber];
        await stream.stop();

        this.log.stream.info(`stop stream: ${ streamNumber }`);

        this.notify();
    }

    /**
    * すべてのストリームを強制的に停止
    */
    public async forcedStopAll(): Promise<void> {
        this.log.system.info('force stop all stremas');

        for(let i = 0; i < this.maxStreaming; i++) {
            if(typeof this.streamStatus[i] === 'undefined') { continue; }
            if(this.streamStatus[i].stream === null) {
                delete this.streamStatus[i];
                continue;
            }

            try {
                this.streamStatus[i].stream!.resetCount(false);
                await this.stop(i);
            } catch(err) {
                this.log.system.error(err);
            }
        }
    }

    /**
    * stream を開始する
    * @param streamNumber: stream number
    * stream: Stream
    */
    private async runStream(streamNumber: number, stream: Stream): Promise<void> {
        try {
            await stream.start(streamNumber);
        } catch(err) {
            delete this.streamStatus[streamNumber];
            throw err;
        }

        this.streamStatus[streamNumber].stream = stream;

        if(stream.getInfo().type === 'MpegTsLive') {
            this.streamStatus[streamNumber].isEnable = true;
        } else {
            // HLS
            //ファイルを定期的に監視して stream.isEnable = true にする
            this.checkStreamEnable(streamNumber);
        }

        this.log.stream.info(`start stream: ${ streamNumber }`);
        this.notify();
    }

    /**
    * HLS のファイルを再生可能になるまで監視して有効化する
    * @param streamNumber: stream number
    */
    private checkStreamEnable(streamNumber: number): void {
        const dirPath = Util.getStreamFilePath();

        let id = setInterval(() => {
            if(typeof this.streamStatus[streamNumber] === 'undefined') {
                clearInterval(id);
                return;
            }

            const fileList = fs.readdirSync(dirPath)

            let tsFileCount = 0;
            let m3u8Flag = false;
            fileList.map((file: string) => {
                if(file.match(`stream${streamNumber}`)) {
                    if(file.match(/.m3u8/)) { m3u8Flag = true; }
                    else { tsFileCount += 1; }
                }
            });

            if(m3u8Flag && tsFileCount >= 3) {
                clearInterval(id);
                this.streamStatus[streamNumber].isEnable = true;
                this.log.stream.info(`enable stream: ${ streamNumber }`);
                this.notify();
            }
        }, 100);
    }

    /**
    * 空いている strema 番号を返す
    */
    private getEmptyStreamNumber(): number | null {
        for(let i = 0; i < this.maxStreaming; i++) { if(typeof this.streamStatus[i] === 'undefined') { return i; } }
        return null;
    }

    /**
    * socketio 通知
    */
    private notify(): void {
        SocketIoServer.getInstance().notifyClient();
    }
}

export { StreamManagerInterface, StreamManager };

