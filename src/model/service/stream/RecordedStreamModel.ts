import { injectable } from 'inversify';
import IRecordedStreamBaseModel from './IRecordedStreamBaseModel';
import RecordedStreamBaseModel from './RecordedStreamBaseModel';

@injectable()
export default class RecordedStreamModel extends RecordedStreamBaseModel implements IRecordedStreamBaseModel {
    /**
     * ストリーム開始
     * @return Promise<void>
     */
    public async start(): Promise<void> {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        await this.setVideFileInfo();
        if (this.videoFilePath === null || this.videoFileInfo === null) {
            throw new Error('SetVideoFileInfoError');
        }
        await this.createProcessOption();

        // 開始時刻が動画の長さを超えている
        if (this.processOption.playPosition > this.videoFileInfo.duration) {
            throw new Error('OutOfRange');
        }

        // file read stream の生成
        try {
            this.setFileStream();
        } catch (err) {
            this.log.stream.error('create file stream error');
            this.log.stream.error(err);
            await this.stop();
            throw new Error('FileStreamSetError');
        }

        // エンコードプロセス生成
        const poption = this.createProcessOption();
        this.log.stream.info(`create encode process: ${poption.cmd}`);
        try {
            this.streamProcess = await this.processManager.create(poption);
        } catch (err) {
            this.log.stream.error(`create encode process failed: ${poption.cmd}`);
            await this.stop();
        }
        if (this.streamProcess === null) {
            throw new Error('CreateStreamProcessError');
        }

        // process 終了時にイベントを発行する
        this.streamProcess.on('exit', () => {
            this.emitExitStream();
        });
        this.streamProcess.on('error', () => {
            this.emitExitStream();
        });

        // ffmpeg debug 用ログ出力
        if (this.streamProcess.stderr !== null) {
            this.streamProcess.stderr.on('data', data => {
                this.log.stream.debug(String(data));
            });
        }

        // パイプ処理
        if (this.streamProcess.stdin !== null && this.fileStream !== null) {
            this.fileStream.pipe(this.streamProcess.stdin);
        }
    }

    protected getStreamType(): 'RecordedStream' {
        return 'RecordedStream';
    }
}
