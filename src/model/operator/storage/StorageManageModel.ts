import { spawn } from 'child_process';
import diskusage from 'diskusage-ng';
import { inject, injectable } from 'inversify';
import Recorded from '../../../db/entities/Recorded';
import ProcessUtil from '../../../util/ProcessUtil';
import Util from '../../../util/Util';
import IRecordedDB from '../../db/IRecordedDB';
import IConfigFile, { RecordedDirInfo } from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IRecordedManageModel from '../recorded/IRecordedManageModel';
import IStorageManageModel from './IStorageManageModel';

@injectable()
export default class StorageManageModel implements IStorageManageModel {
    private log: ILogger;
    private config: IConfigFile;
    private recordedManage: IRecordedManageModel;
    private recordedDB: IRecordedDB;

    private isRunning: boolean = false;
    private timerId: NodeJS.Timeout | null = null;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IRecordedManageModel') recordedManage: IRecordedManageModel,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.recordedManage = recordedManage;
        this.recordedDB = recordedDB;
    }

    /**
     * 空き容量チェック開始
     */
    public start(): void {
        const checkList: RecordedDirInfo[] = [];
        for (const r of this.config.recorded) {
            if (typeof r.limitThreshold !== 'undefined') {
                checkList.push(r);
            }
        }

        // 空き容量チェックが必要なければ何もしない
        if (checkList.length === 0) {
            return;
        }

        this.timerId = setInterval(async () => {
            await this.check(checkList).catch(err => {
                this.isRunning = false;
                this.log.system.error('disk check error');
                this.log.system.error(err);
            });
        }, this.config.storageLimitCheckIntervalTime * 1000);
    }

    /**
     * 空き容量をチェックし、空きがなければ録画を削除する
     * @param list: RecordedDirInfo[]
     */
    private async check(list: RecordedDirInfo[]): Promise<void> {
        if (this.isRunning === true) {
            return;
        }
        this.isRunning = true;

        for (const l of list) {
            if (typeof l.limitThreshold === 'undefined') {
                continue;
            }

            let free: number;
            try {
                free = await this.getFreeSize(l.path);
            } catch (err) {
                this.log.system.error(`get disk info error: ${l.path}`);
                this.log.system.error(err);

                continue;
            }
            free = free / 1024 / 1024; // MB に換算

            // 空き容量が閾値を超えたか
            if (free > l.limitThreshold) {
                continue;
            }

            if (typeof l.limitCmd !== 'undefined') {
                // run cmd
                this.log.system.info(`run storage limit cmd: ${l.limitCmd}`);
                try {
                    const cmds = ProcessUtil.parseCmdStr(l.limitCmd);
                    // 互換性のためここでは全ての環境変数を渡すため env は未指定
                    spawn(cmds.bin, cmds.args, {
                        stdio: 'ignore',
                    });
                } catch (err) {
                    this.log.system.error(`limit cmd error: ${l.limitCmd}`);
                    this.log.system.error(err);
                }
            }

            if (l.action === 'remove') {
                while (free <= l.limitThreshold) {
                    this.log.system.info(`name: ${l.name}, free: ${free}, threshold: ${l.limitThreshold}`);

                    // 削除
                    let recorded: Recorded | null = null;
                    try {
                        recorded = await this.recordedDB.findOld();
                    } catch (err) {
                        this.log.system.error('failed to find old recorded');
                        this.log.system.error(err);
                        break;
                    }

                    // 削除すべき録画が見つからなかった
                    if (recorded === null) {
                        this.log.system.error('find old recorded error');
                        break;
                    }

                    // 録画を削除
                    try {
                        await this.recordedManage.delete(recorded.id);
                    } catch (err) {
                        this.log.system.error(err);
                        break;
                    }

                    // 空き容量取得
                    try {
                        free = await this.getFreeSize(l.path);
                    } catch (err) {
                        this.log.system.error(`get disk info error: ${l.path}`);
                        this.log.system.error(err);
                        break;
                    }

                    await Util.sleep(100);
                }
            }
        }

        this.isRunning = false;
    }

    /**
     * 空き容量を取得する
     * @param dirPath: ディレクトリパス
     * @return Promise<number>
     */
    private getFreeSize(dirPath: string): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            diskusage(dirPath, (err, usage) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(usage.available);
                }
            });
        });
    }

    /**
     * 空き容量チェックを停止
     */
    public stop(): void {
        if (this.timerId !== null) {
            clearInterval(this.timerId);
        }
    }
}
