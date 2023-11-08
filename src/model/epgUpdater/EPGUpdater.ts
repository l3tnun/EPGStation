import { inject, injectable } from 'inversify';
import IConfigFile from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IEPGUpdateManageModel from './IEPGUpdateManageModel';
import IEPGUpdater from './IEPGUpdater';

@injectable()
class EPGUpdater implements IEPGUpdater {
    private log: ILogger;
    private config: IConfigFile;
    private updateManage: IEPGUpdateManageModel;

    private isEventStreamAlive: boolean = false;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IEPGUpdateManageModel') updateManage: IEPGUpdateManageModel,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.updateManage = updateManage;

        this.updateManage.on('program updated', () => {
            this.notify();
        });
        this.updateManage.on('service updated', () => {
            this.notify();
        });
    }

    /**
     * EPG 更新処理開始
     */
    public async start(): Promise<void> {
        this.log.system.info('start EPG update');
        this.startEventStreamAnalysis();
        await this.updateManage.updateAll().catch(err => {
            this.log.system.fatal('epg initialization update error');
            throw err;
        });
        this.notify();

        const updateTime = this.config.epgUpdateIntervalTime;

        // EventStream 監視ループ(watchdog)
        setInterval(async () => {
            try {
                if (this.isEventStreamAlive === false) {
                    // stream event に何らかの問題が発生した
                    this.startEventStreamAnalysis();
                    await this.updateManage.updateAll();
                }
            } catch (err: any) {
                this.log.system.error('EPG update error');
                this.log.system.error(err);
            }
        }, 10 * 1000);

        // 溜め込んだQueueを設定ファイルで指定されたサイクルでDBへ保存
        setInterval(
            async () => {
                try {
                    if (this.isEventStreamAlive === true) {
                        await this.updateManage.saveService();
                    }
                } catch (err: any) {
                    this.log.system.error('service update error');
                    this.log.system.error(err);
                }
            },
            updateTime * 60 * 1000,
        );
        setInterval(
            async () => {
                try {
                    if (this.isEventStreamAlive === true) {
                        await this.updateManage.saveProgram();
                    }
                } catch (err: any) {
                    this.log.system.error('program update error');
                    this.log.system.error(err);
                }
            },
            updateTime * 60 * 1000,
        );

        // 放送中や放送開始時刻が間近の番組は短いサイクルでDBへ保存する
        // NOTE: DB負荷などを考慮しEvent受信と同時のDB反映は見合わせる
        setInterval(async () => {
            try {
                if (this.isEventStreamAlive === true) {
                    const timeThreshold = new Date().getTime() + 5 * 60 * 1000;
                    await this.updateManage.saveProgram(timeThreshold);
                }
            } catch (err: any) {
                this.log.system.error('EPG update error');
                this.log.system.error(err);
            }
        }, 10 * 1000);

        setInterval(
            async () => {
                // 古い番組情報を削除
                this.log.system.info('delete old programs');
                await this.updateManage.deleteOldPrograms().catch(err => {
                    this.log.system.error('delete old programs error');
                    this.log.system.error(err);
                });
            },
            30 * 60 * 1000,
        );
    }

    /**
     * mirakurun の event stream 解析開始
     * stream に問題が発生した場合は this.isEventStreamAlive が false になる
     */
    private async startEventStreamAnalysis(): Promise<void> {
        this.isEventStreamAlive = true;
        try {
            await this.updateManage.start();
        } catch (err: any) {
            this.log.system.error('destroy event stream');
            this.isEventStreamAlive = false;
        }
    }

    /**
     * 親プロセスへ更新が完了したことを知らせる
     */
    private notify(): void {
        if (typeof process.send !== 'undefined') {
            process.send({ msg: 'updated' });
        }
    }
}

export default EPGUpdater;
