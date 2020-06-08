import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import FileUtil from '../../../util/FileUtil';
import IConfiguration from '../../IConfiguration';
import ILoggerModel from '../../ILoggerModel';
import IMirakurunClientModel from '../../IMirakurunClientModel';
import IEncodeProcessManageModel, { CreateProcessOption } from '../encode/IEncodeProcessManageModel';
import IHLSFileDeleterModel from './IHLSFileDeleterModel';
import ILiveStreamBaseModel from './ILiveStreamBaseModel';
import LiveStreamBaseModel from './LiveStreamBaseModel';

@injectable()
export default class LiveHLSStreamModel extends LiveStreamBaseModel implements ILiveStreamBaseModel {
    private fileDeleter: IHLSFileDeleterModel;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IEncodeProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IMirakurunClientModel') mirakurunClientModel: IMirakurunClientModel,
        @inject('IHLSFileDeleterModel') fileDeleter: IHLSFileDeleterModel,
    ) {
        super(configure, logger, processManager, mirakurunClientModel);

        this.fileDeleter = fileDeleter;
    }

    /**
     * ストリーム開始
     * @param streamId: apid.StreamId
     * @return Promise<void>
     */
    public async start(streamId: apid.StreamId): Promise<void> {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        // streamFilePath の存在チェック
        try {
            await FileUtil.access(this.config.streamFilePath, fs.constants.R_OK | fs.constants.W_OK);
        } catch (err) {
            if (typeof err.code !== 'undefined' && err.code === 'ENOENT') {
                // ディレクトリが存在しないので作成する
                this.log.stream.info(`mkdirp: ${this.config.streamFilePath}`);
                await FileUtil.mkdir(this.config.streamFilePath);
            } else {
                // アクセス権に Read or Write が無い
                this.log.stream.fatal(`dir permission error: ${this.config.streamFilePath}`);
                this.log.stream.fatal(err);
                throw err;
            }
        }

        // ゴミファイルを削除
        await this.fileDeleter.setOption({
            streamId: streamId,
            streamFilePath: this.config.streamFilePath,
        });
        await this.fileDeleter.deleteAllFiles();

        // 放送波受信
        await this.setMirakurunStream(this.config);
        if (this.stream === null) {
            throw new Error('SetStreamError');
        }

        // エンコードプロセス生成
        const poption = this.createHLSProcessOption(streamId);
        this.log.stream.info(`create encode process: ${poption.cmd}`);
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

        // ファイル自動削除開始
        this.fileDeleter.start();
    }

    /**
     * stream プロセス生成に必要な情報を生成する
     * @return CreateProcessOption | null プロセス生成する必要がない場合は null を返す
     */
    private createHLSProcessOption(streamId: apid.StreamId): CreateProcessOption {
        const option = this.createProcessOption();
        if (option === null) {
            throw new Error('CreateProcessOptionError');
        }

        option.cmd = option.cmd
            .replace(/%streamFileDir%/g, this.config.streamFilePath)
            .replace(/%streamNum%/g, streamId.toString(10));

        option.output = `${this.config.streamFilePath}\/stream${streamId}.m3u8`;

        return option;
    }

    protected getStreamType(): 'LiveHLS' {
        return 'LiveHLS';
    }

    public async stop(): Promise<void> {
        await super.stop();

        this.fileDeleter.stop();
        await this.fileDeleter.deleteAllFiles();
    }
}
