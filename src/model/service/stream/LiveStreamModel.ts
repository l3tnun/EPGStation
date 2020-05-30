import { injectable } from 'inversify';
import * as apid from '../../../../api';
import ILiveStreamBaseModel from './ILiveStreamBaseModel';
import LiveStreamBaseModel from './LiveStreamBaseModel';

@injectable()
export default class LiveStreamModel extends LiveStreamBaseModel implements ILiveStreamBaseModel {
    /**
     * ストリーム開始
     * @return Promise<void>
     */
    public async start(): Promise<void> {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        const config = this.configure.getConfig();
        const mirakurun = this.mirakurunClientModel.getClient();
        mirakurun.priority = config.streamingPriority;

        // 放送波受信
        this.log.stream.info(`ger mirakurun service stream: ${this.processOption.channelId}`);
        this.stream = await mirakurun
            .getServiceStream(this.processOption.channelId, true, config.streamingPriority)
            .catch(err => {
                this.stream = null;
                this.log.system.error(`get mirakurun service stream failed: ${this.processOption!.channelId}`);
                throw err;
            });

        // エンコードプロセスの生成が必要かチェック
        const poption = this.createProcessOption();
        if (poption !== null) {
            // エンコードプロセス生成
            this.log.system.info(`create encode process: ${poption.cmd}`);
            this.streamProcess = await this.processManager.create(poption).catch(err => {
                if (this.stream !== null) {
                    this.stream.unpipe();
                    this.stream.destroy();
                }

                this.log.stream.error(`create encode process failed: ${poption.cmd}`);
                throw err;
            });

            // process 終了にイベントを発行する
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
            if (this.streamProcess.stdin !== null) {
                this.stream.pipe(this.streamProcess.stdin);
            } else {
                await this.stop();

                throw new Error('StreamProcessStdinIsNull');
            }
        } else {
            // stream 停止処理時にイベントを発行する
            this.stream.on('close', () => {
                this.emitExitStream();
            });
            this.stream.on('end', () => {
                this.emitExitStream();
            });
            this.stream.on('error', () => {
                this.emitExitStream();
            });
        }
    }

    protected getStreamType(): apid.StreamType {
        return 'LiveStream';
    }
}
