import { spawn } from 'child_process';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import Recorded from '../../../db/entities/Recorded';
import Reserve from '../../../db/entities/Reserve';
import ProcessUtil from '../../../util/ProcessUtil';
import IVideoUtil from '../../api/video/IVideoUtil';
import IChannelDB from '../../db/IChannelDB';
import IRecordedDB from '../../db/IRecordedDB';
import { OperatorFinishEncodeInfo } from '../../event/IOperatorEncodeEvent';
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
    private recordedDB: IRecordedDB;
    private videoUtil: IVideoUtil;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IPromiseQueue') queue: IPromiseQueue,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.queue = queue;
        this.channelDB = channelDB;
        this.recordedDB = recordedDB;
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
     * エンコードのコマンド実行を queue に追加する
     * @param info: OperatorFinishEncodeInfo
     */
    public addEncodingFinishCmd(info: OperatorFinishEncodeInfo): void {
        this.log.system.info(`encodingFinishCommand: ${this.config.encodingFinishCommand}`);
        if (typeof this.config.encodingFinishCommand === 'undefined') {
            return;
        }

        this.addFinishEncode(this.config.encodingFinishCommand, info);
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
     * 外部コマンド実行を queue に追加する
     * @param cmd: string コマンド
     * @param info OperatorFinishEncodeInfo
     */
    private addFinishEncode(cmd: string, info: OperatorFinishEncodeInfo): void {
        this.queue.add<void>(() => {
            return this.createFinishEncodeCmd(cmd, info).catch(err => {
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
                    HALF_WIDTH_CHANNELNAME: channel === null ? null : channel.halfWidthName,
                    STARTAT: reserve.startAt,
                    ENDAT: reserve.endAt,
                    DURATION: reserve.endAt - reserve.startAt,
                    NAME: reserve.name,
                    HALF_WIDTH_NAME: reserve.halfWidthName,
                    DESCRIPTION: reserve.description,
                    HALF_WIDTH_DESCRIPTION: reserve.halfWidthDescription,
                    EXTENDED: reserve.extended,
                    HALF_WIDTH_EXTENDED: reserve.halfWidthExtended,
                },
            } as any);

            child.on('exit', () => {
                if (child.exitCode == 0) {
                    this.log.system.info(`finish: ${cmd}`);
                } else {
                    this.log.system.error(`failed: ${cmd}. exit: ${child.exitCode}`);
                }
                resolve();
            });

            child.on('error', err => {
                this.log.system.error(`failed: ${cmd}`);
                this.log.system.error(err);
                resolve();
            });

            // プロセスの即時終了対応
            if (ProcessUtil.isExited(child) === true) {
                child.removeAllListeners();
                if (child.exitCode === 0) {
                    this.log.system.info(`finish: ${cmd}`);
                } else {
                    this.log.system.error(`failed: ${cmd}`);
                }
                resolve();
            }
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

        return new Promise<void>(async resolve => {
            const child = spawn(cmds.bin, cmds.args, {
                stdio: 'ignore',
                env: {
                    PATH: process.env['PATH'],
                    RECORDEDID: recorded.id,
                    PROGRAMID: recorded.programId,
                    CHANNELTYPE: channel === null ? null : channel.channelType,
                    CHANNELID: recorded.channelId,
                    CHANNELNAME: channel === null ? null : channel.name,
                    HALF_WIDTH_CHANNELNAME: channel === null ? null : channel.halfWidthName,
                    STARTAT: recorded.startAt,
                    ENDAT: recorded.endAt,
                    DURATION: recorded.endAt - recorded.startAt,
                    NAME: recorded.name,
                    HALF_WIDTH_NAME: recorded.halfWidthName,
                    DESCRIPTION: recorded.description,
                    HALF_WIDTH_DESCRIPTION: recorded.halfWidthDescription,
                    EXTENDED: recorded.extended,
                    HALF_WIDTH_EXTENDED: recorded.halfWidthExtended,
                    RECPATH:
                        typeof recorded.videoFiles === 'undefined' || recorded.videoFiles.length < 0
                            ? null
                            : await this.videoUtil.getFullFilePathFromId(recorded.videoFiles[0].id),
                    LOGPATH:
                        typeof recorded.dropLogFile === 'undefined' || recorded.dropLogFile === null
                            ? null
                            : path.join(this.config.dropLog, recorded.dropLogFile.filePath),
                    ERROR_CNT: recorded.dropLogFile?.errorCnt.toString(10) || null,
                    DROP_CNT: recorded.dropLogFile?.dropCnt.toString(10) || null,
                    SCRAMBLING_CNT: recorded.dropLogFile?.scramblingCnt.toString(10) || null,
                },
            } as any);

            child.on('exit', () => {
                if (child.exitCode == 0) {
                    this.log.system.info(`${cmd} process is fin`);
                } else {
                    this.log.system.error(`${cmd} process is error. exit: ${child.exitCode}`);
                }
                resolve();
            });

            child.on('error', err => {
                this.log.system.error(`${cmd} process is error`);
                this.log.system.error(String(err));
                resolve();
            });

            // プロセスの即時終了対応
            if (ProcessUtil.isExited(child) === true) {
                child.removeAllListeners();
                if (child.exitCode === 0) {
                    this.log.system.info(`finish: ${cmd}`);
                } else {
                    this.log.system.error(`failed: ${cmd}`);
                }
                resolve();
            }
        });
    }

    /**
     * 外部コマンドを実行する
     * @param cmd string
     * @param info OperatorFinishEncodeInfo
     */
    private async createFinishEncodeCmd(cmd: string, info: OperatorFinishEncodeInfo): Promise<void> {
        this.log.system.info(`execute cmd: ${cmd}`);

        const cmds = ProcessUtil.parseCmdStr(cmd);

        // 番組情報を取得する
        const recorded = await this.recordedDB.findId(info.recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNotFound');
        }

        // 局を取得する
        const channel = await this.channelDB.findId(recorded.channelId);
        if (channel === null) {
            throw new Error('ChannelIsNotFound');
        }

        return new Promise<void>(async resolve => {
            const child = spawn(cmds.bin, cmds.args, {
                stdio: 'ignore',
                env: {
                    PATH: process.env['PATH'],
                    RECORDEDID: info.recordedId,
                    VIDEOFILEID: info.videoFileId === null ? '' : info.videoFileId,
                    OUTPUTPATH:
                        info.videoFileId === null ? null : await this.videoUtil.getFullFilePathFromId(info.videoFileId),
                    MODE: info.mode,
                    NAME: recorded.name,
                    HALF_WIDTH_NAME: recorded.halfWidthName,
                    DESCRIPTION: recorded.description || '',
                    HALF_WIDTH_DESCRIPTION: recorded.halfWidthDescription || '',
                    EXTENDED: recorded.extended || '',
                    HALF_WIDTH_EXTENDED: recorded.halfWidthExtended || '',
                    CHANNELID: typeof recorded.channelId === 'number' ? recorded.channelId.toString(10) : '',
                    CHANNELNAME: typeof channel.name === 'string' ? channel.name : '',
                    HALF_WIDTH_CHANNELNAME: typeof channel.halfWidthName === 'string' ? channel.halfWidthName : '',
                },
            } as any);

            child.on('exit', () => {
                if (child.exitCode == 0) {
                    this.log.system.info(`${cmd} process is fin`);
                } else {
                    this.log.system.error(`${cmd} process is error. exit: ${child.exitCode}`);
                }
                resolve();
            });

            child.on('error', err => {
                this.log.system.error(`${cmd} process is error`);
                this.log.system.error(String(err));
                resolve();
            });

            // プロセスの即時終了対応
            if (ProcessUtil.isExited(child) === true) {
                child.removeAllListeners();
                if (child.exitCode === 0) {
                    this.log.system.info(`finish: ${cmd}`);
                } else {
                    this.log.system.error(`failed: ${cmd}`);
                }
                resolve();
            }
        });
    }
}
