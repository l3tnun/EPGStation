import { spawn } from 'child_process';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import Recorded from '../../../db/entities/Recorded';
import Reserve from '../../../db/entities/Reserve';
import ProcessUtil from '../../../util/ProcessUtil';
import IVideoUtil from '../../api/video/IVideoUtil';
import IChannelDB from '../../db/IChannelDB';
import { IReserveUpdateValues } from '../../event/IReserveEvent';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import { IPromiseQueue } from '../../IPromiseQueue';
import IExternalCommandManageModel from './IExternalCommandManageModel';

@injectable()
export default class ExternalCommandManageModel implements IExternalCommandManageModel {
    private log: ILogger;
    private config: IConfigFile;
    private queue: IPromiseQueue;
    private channelDB: IChannelDB;
    private videoUtil: IVideoUtil;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IPromiseQueue') queue: IPromiseQueue,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.queue = queue;
        this.channelDB = channelDB;
        this.videoUtil = videoUtil;
    }

    /**
     * 予約情報更新時のコマンド実行を queue に追加する
     * @param diff: IReserveUpdateValues
     */
    public addUpdateReseves(diff: IReserveUpdateValues): void {
        if (
            typeof diff.insert !== 'undefined' &&
            diff.insert.length > 0 &&
            typeof this.config.reserveNewAddtionCommand !== 'undefined'
        ) {
            for (const r of diff.insert) {
                this.addReserve(this.config.reserveNewAddtionCommand, r);
            }
        }

        if (
            typeof diff.update !== 'undefined' &&
            diff.update.length > 0 &&
            typeof this.config.reserveUpdateCommand !== 'undefined'
        ) {
            for (const r of diff.update) {
                this.addReserve(this.config.reserveUpdateCommand, r);
            }
        }

        if (
            typeof diff.delete !== 'undefined' &&
            diff.delete.length > 0 &&
            typeof this.config.reservedeletedCommand !== 'undefined'
        ) {
            for (const r of diff.delete) {
                this.addReserve(this.config.reservedeletedCommand, r);
            }
        }
    }

    /**
     * 録画準備開始時のコマンド実行を queue に追加する
     * @param reserve: Reserve
     */
    public addRecordingPrepStartCmd(reserve: Reserve): void {
        if (typeof this.config.recordingPreStartCommand === 'undefined') {
            return;
        }

        this.addReserve(this.config.recordingPreStartCommand, reserve);
    }

    /**
     * 録画準備失敗時のコマンド実行を queue に追加する
     * @param reserve: Reserve
     */
    public addRecordingPrepRecFailedCmd(reserve: Reserve): void {
        if (typeof this.config.recordingPrepRecFailedCommand === 'undefined') {
            return;
        }

        this.addReserve(this.config.recordingPrepRecFailedCommand, reserve);
    }

    /**
     * 録画開始時のコマンド実行を queue に追加する
     * @param recorded: Recorded
     */
    public addRecordingStartCmd(recorded: Recorded): void {
        if (typeof this.config.recordingStartCommand === 'undefined') {
            return;
        }

        this.addRecorded(this.config.recordingStartCommand, recorded);
    }

    /**
     * 録画終了時のコマンド実行を queue に追加する
     * @param recorded: Recorded
     */
    public addRecordingFinishCmd(recorded: Recorded): void {
        if (typeof this.config.recordingFinishCommand === 'undefined') {
            return;
        }

        this.addRecorded(this.config.recordingFinishCommand, recorded);
    }

    /**
     * 録画中にエラー発生時のコマンド実行を queue に追加する
     * @param recorded: Recorded
     */
    public addRecordingFailedCmd(recorded: Recorded): void {
        if (typeof this.config.recordingFailedCommand === 'undefined') {
            return;
        }

        this.addRecorded(this.config.recordingFailedCommand, recorded);
    }

    /**
     * 外部コマンド実行を queue に追加する
     * @param cmd: string コマンド
     * @param reserve: Reserve
     */
    private addReserve(cmd: string, reserve: Reserve): void {
        this.queue.add<void>(() => {
            return this.createReserveCmd(cmd, reserve).catch(err => {
                this.log.system.error(`execute cmd error: ${cmd}`);
                this.log.system.error(err);
            });
        });
    }

    /**
     * 外部コマンド実行を queue に追加する
     * @param cmd: string コマンド
     * @param reserve: Recorded
     */
    private addRecorded(cmd: string, reserve: Recorded): void {
        this.queue.add<void>(() => {
            return this.createRecordedCmd(cmd, reserve).catch(err => {
                this.log.system.error(`execute cmd error: ${cmd}`);
                this.log.system.error(err);
            });
        });
    }

    /**
     * 外部コマンドを実行する
     * @param cmd: string
     * @param reserve: Reserve
     */
    private async createReserveCmd(cmd: string, reserve: Reserve): Promise<void> {
        this.log.system.info(`execute cmd: ${cmd}`);

        const cmds = ProcessUtil.parseCmdStr(cmd);

        const channel = await this.channelDB.findId(reserve.channelId);

        return new Promise<void>(resolve => {
            const child = spawn(cmds.bin, cmds.args, {
                stdio: 'ignore',
                env: {
                    PATH: process.env['PATH'],
                    RESERVEID: reserve.id,
                    PROGRAMID: reserve.programId,
                    CHANNELTYPE: reserve.channelType,
                    CHANNELID: reserve.channelId,
                    CHANNELNAME: channel === null ? null : channel.name,
                    STARTAT: reserve.startAt,
                    ENDAT: reserve.endAt,
                    DURATION: reserve.endAt - reserve.startAt,
                    NAME: reserve.name,
                    DESCRIPTION: reserve.description,
                    EXTENDED: reserve.extended,
                },
            } as any);

            child.on('exit', () => {
                this.log.system.info(`finish: ${cmd}`);
                resolve();
            });

            child.on('error', err => {
                this.log.system.info(`failed: ${cmd}`);
                this.log.system.error(err);
                resolve();
            });
        });
    }

    /**
     * 外部コマンドを実行する
     * @param cmd: string
     * @param recorded: Recorded
     */
    private async createRecordedCmd(cmd: string, recorded: Recorded): Promise<void> {
        this.log.system.info(`execute cmd: ${cmd}`);

        const cmds = ProcessUtil.parseCmdStr(cmd);

        const channel = await this.channelDB.findId(recorded.channelId);

        return new Promise<void>(resolve => {
            const child = spawn(cmds.bin, cmds.args, {
                stdio: 'ignore',
                env: {
                    PATH: process.env['PATH'],
                    RECORDEDID: recorded.id,
                    PROGRAMID: recorded.programId,
                    CHANNELTYPE: channel === null ? null : channel.channelType,
                    CHANNELID: recorded.channelId,
                    CHANNELNAME: channel === null ? null : channel.name,
                    STARTAT: recorded.startAt,
                    ENDAT: recorded.endAt,
                    DURATION: recorded.endAt - recorded.startAt,
                    NAME: recorded.name,
                    DESCRIPTION: recorded.description,
                    EXTENDED: recorded.extended,
                    RECPATH:
                        typeof recorded.videoFiles === 'undefined' || recorded.videoFiles.length < 0
                            ? null
                            : this.videoUtil.getFullFilePathFromId(recorded.videoFiles[0].id),
                    LOGPATH:
                        typeof recorded.dropLogFile === 'undefined' || recorded.dropLogFile === null
                            ? null
                            : path.join(this.config.dropLog, recorded.dropLogFile.filePath),
                },
            } as any);

            child.on('exit', () => {
                this.log.system.info(`${cmd} process is fin`);
                resolve();
            });

            child.on('error', err => {
                this.log.system.error(`${cmd} process is error`);
                this.log.system.error(String(err));
                resolve();
            });
        });
    }
}
