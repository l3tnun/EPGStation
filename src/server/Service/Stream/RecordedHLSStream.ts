import { ChildProcess } from 'child_process';
import { StreamInfo, Stream } from './Stream';
import * as apid from '../../../../api';
import ProcessUtil from '../Util/ProcessUtil';
import { RecordedDBInterface } from '../../Model/DB/RecordedDB';
import { EncodedDBInterface } from '../../Model/DB/EncodedDB';
import Util from '../../Util/Util';
import HLSFileDeleter from './HLSFileDeleter';

interface RecordedHLSStreamInfo extends StreamInfo {
    recordedId: apid.RecordedId;
}

/**
* 録画済みファイル HLS 配信
*/
class RecordedHLSStream extends Stream {
    private recordedId: apid.RecordedId;
    private encodedId: apid.EncodedId | null;
    private mode: number;
    private enc: ChildProcess | null = null;
    private recordedDB: RecordedDBInterface;
    private encodedDB: EncodedDBInterface;

    private fileDeleter: HLSFileDeleter | null = null;

    /**
    * @param recordedDB: RecordedDB
    * @param encodedDB: EncodedDB
    * @param recordedId: recorded id
    * @param mode: config.recordedHLS の index number
    * @param encodedId: encoded id
    */
    constructor(
        recordedDB: RecordedDBInterface,
        encodedDB: EncodedDBInterface,
        recordedId: apid.RecordedId,
        mode: number,
        encodedId: apid.EncodedId | null = null,
    ) {
        super();

        this.recordedDB = recordedDB;
        this.encodedDB = encodedDB;
        this.recordedId = recordedId;
        this.mode = mode;
        this.encodedId = encodedId;
    }

    public async start(streamNumber: number): Promise<void> {
        await super.start(streamNumber);

        // file path を取得
        let recorded = await this.recordedDB.findId(this.recordedId);
        if(recorded.length === 0) { throw new Error('RecordedFileIsNotFound'); }

        let filePath: string | null = null;
        if(this.encodedId === null && recorded[0].recPath !== null) {
            filePath = String(recorded[0].recPath);
        } else if(this.encodedId !== null) {
            let encoded = await this.encodedDB.findId(this.encodedId);
            if(encoded === null) { throw new Error('EncodedFileIsNotFound'); }
            filePath = encoded.path;
        }

        if(filePath === null) { throw new Error('FileIsNotFound'); }

        // config の取得
        const config = this.config.getConfig();
        const streamFilePath = Util.getStreamFilePath();
        const recordedHLS = config.recordedHLS;
        if(typeof recordedHLS === 'undefined' || typeof recordedHLS[this.mode] === 'undefined') { throw new Error('recordedHLSConfigError'); }

        // ゴミファイルを削除
        this.fileDeleter = new HLSFileDeleter(streamNumber);
        this.fileDeleter.deleteAllFiles();

        try {
            // エンコードプロセス生成
            const cmd = recordedHLS[this.mode].cmd.replace(/%streamFileDir%/g, streamFilePath).replace(/%streamNum%/g, String(streamNumber));
            this.enc = await this.process.create(filePath, `${ streamFilePath }\/stream${ streamNumber }.m3u8`, cmd, Stream.priority);

            this.enc.on('exit', (code: number) => { if(code != 0) { this.ChildExit(streamNumber); } });
            this.enc.on('error', () => { this.ChildExit(streamNumber); });

            this.enc.stderr.on('data', (data) => { this.log.stream.debug(String(data)); });
        } catch(err) {
            await this.stop();
            throw err;
        }
    }

    public async stop(): Promise<void> {
        if(this.enc !== null) {
            await ProcessUtil.kill(this.enc);
        }

        if(this.fileDeleter !== null) {
            // 変換済みファイルを削除
            this.fileDeleter.deleteAllFiles()
        }
    }

    public getInfo(): RecordedHLSStreamInfo {
        return {
            type: 'RecordedHLS',
            recordedId: this.recordedId,
            mode: this.mode,
        };
    }

    public getEncChild(): ChildProcess | null { return this.enc; }

    public getMirakurunStream(): null { return null; }
}

export { RecordedHLSStreamInfo, RecordedHLSStream };

