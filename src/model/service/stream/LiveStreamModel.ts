import { ChildProcess } from 'child_process';
import * as events from 'events';
import * as http from 'http';
import { inject, injectable } from 'inversify';
import internal from 'stream';
import * as apid from '../../../../api';
import ProcessUtil from '../../../util/ProcessUtil';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IMirakurunClientModel from '../../IMirakurunClientModel';
import IEncodeProcessManageModel, { CreateProcessOption } from '../encode/IEncodeProcessManageModel';
import ILiveStreamBaseModel, { LiveStreamOption } from './ILiveStreamBaseModel';

@injectable()
class LiveStreamModel implements ILiveStreamBaseModel {
    private configure: IConfiguration;
    private log: ILogger;
    private processManager: IEncodeProcessManageModel;
    private mirakurunClientModel: IMirakurunClientModel;
    private emitter: events.EventEmitter = new events.EventEmitter();

    private processOption: LiveStreamOption | null = null;
    private stream: http.IncomingMessage | null = null;
    private streamProcess: ChildProcess | null = null;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IEncodeProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IMirakurunClientModel') mirakurunClientModel: IMirakurunClientModel,
    ) {
        this.configure = configure;
        this.log = logger.getLogger();
        this.processManager = processManager;
        this.mirakurunClientModel = mirakurunClientModel;
    }

    /**
     * stream 生成に必要な情報を渡す
     * @param option: LiveStreamOption
     */
    public setOption(option: LiveStreamOption): void {
        this.processOption = option;
    }

    /**
     * stream プロセス生成に必要な情報を生成する
     * @return CreateProcessOption | null プロセス生成する必要がない場合は null を返す
     */
    public createProcessOption(): CreateProcessOption | null {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        /**
         * mirakurun の stream をそのまま横流しする
         */
        if (typeof this.processOption.cmd === 'undefined') {
            return null;
        }

        const config = this.configure.getConfig();
        const cmd = this.processOption.cmd.replace('%FFMPEG%', config.ffmpeg);

        return {
            input: null,
            output: null,
            cmd: cmd,
            priority: LiveStreamModel.ENCODE_PROCESS_PRIORITY,
        };
    }

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

    /**
     * ストリーム停止
     * @return Promise<void>
     */
    public async stop(): Promise<void> {
        if (this.stream !== null) {
            this.stream.unpipe();
            this.stream.destroy();
        }

        if (this.streamProcess !== null) {
            await ProcessUtil.kill(this.streamProcess);
        }
    }

    /**
     * 生成したストリームを返す
     * @return internal.Readable | null
     */
    public getStream(): internal.Readable {
        if (this.streamProcess !== null && this.streamProcess.stdout !== null) {
            return this.streamProcess.stdout;
        } else if (this.stream !== null) {
            return this.stream;
        } else {
            throw new Error('StreamIsNull');
        }
    }

    /**
     * ストリーム情報を返す
     * @return apid.LiveStreamInfo
     */
    public getInfo(): apid.LiveStreamInfo {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        return {
            type: 'LiveStream',
            channelId: this.processOption.channelId,
        };
    }

    /**
     * ストリーム終了イベントへ登録
     * @param callback: () => void
     */
    public setExitStream(callback: () => void): void {
        this.emitter.on(LiveStreamModel.EXIT_EVENT, async () => {
            try {
                callback();
            } catch (err) {
                this.log.stream.error('exit stream callback error');
                this.log.stream.error(err);
            }
        });
    }

    /**
     * ストリーム終了イベント発行
     */
    private emitExitStream(): void {
        this.emitter.emit(LiveStreamModel.EXIT_EVENT);
    }
}

namespace LiveStreamModel {
    export const ENCODE_PROCESS_PRIORITY = 1;
    export const EXIT_EVENT = 'exitEvent';
}

export default LiveStreamModel;
