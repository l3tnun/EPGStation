import { inject, injectable } from 'inversify';
import IConfigFile from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IEPGUpdateManageModel from './IEPGUpdateManageModel';
import IEPGUpdater from './IEPGUpdater';
import Util from '../../util/Util';

@injectable()
class EPGUpdater implements IEPGUpdater {
    private log: ILogger;
    private config: IConfigFile;
    private updateManage: IEPGUpdateManageModel;

    private isEventStreamAlive: boolean = false;
    private lastUpdatedTime: number = 0;
    private lastDeletedTime: number = 0;
    private retryCount: number = 0;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IEPGUpdateManageModel') updateManage: IEPGUpdateManageModel,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.updateManage = updateManage;

        this.updateManage.on('program updated', () => {
            this.lastUpdatedTime = new Date().getTime();
            this.notify();
        });

        this.updateManage.on('service updated', () => {
            this.notify();
        });

        this.updateManage.on('event stream started', async () => {
            this.log.system.info('event stream started');
            this.retryCount = 0;
            try {
                await this.updateManage.updateAll();
                this.notify();
            } catch (err: any) {
                this.log.system.error('updateAll error');
            }
            // updateAllが完了して以降、queueフラッシュ処理を有効にするために
            // この位置でisEventStreamAliveをtrueにする
            this.isEventStreamAlive = true;
        });

        this.updateManage.on('event stream aborted', () => {
            this.log.system.info('has disconnected from the mirakurun');
            this.isEventStreamAlive = false;
        });
    }

    /**
     * EPG 更新処理開始
     */
    public async start(): Promise<void> {
        this.log.system.info('start EPG update');

        const updateInterval = this.config.epgUpdateIntervalTime * 60 * 1000;

        // event streamを開始
        this.startEventStreamAnalysis();

        // 溜め込んだservice queueを設定ファイルで指定されたサイクルでDBへ保存
        setInterval(async () => {
            if (this.isEventStreamAlive === true) {
                try {
                    await this.updateManage.saveService();
                } catch (err: any) {
                    this.log.system.error('service update error');
                    this.log.system.error(err);
                }
            }
        }, updateInterval);

        // 放送中や放送開始時刻が間近の番組は短いサイクルでDBへ保存する
        // NOTE: DB負荷などを考慮しEvent受信と同時のDB反映は見合わせる
        setInterval(async () => {
            if (this.isEventStreamAlive === true) {
                const now = new Date().getTime();
                try {
                    await this.updateManage.saveProgram(now + 5 * 60 * 1000);
                    if (this.lastUpdatedTime + updateInterval <= now) {
                        await this.updateManage.saveProgram();
                        this.lastUpdatedTime = now;
                    }
                } catch (err: any) {
                    this.log.system.error('EPG update error');
                    this.log.system.error(err);
                }

                if (this.lastDeletedTime + updateInterval <= now) {
                    // 古い番組情報を削除
                    await this.updateManage.deleteOldPrograms().catch(err => {
                        this.log.system.error('delete old programs error');
                        this.log.system.error(err);
                    });
                    this.lastDeletedTime = now;
                }
            }
        }, 10 * 1000);
    }

    /**
     * mirakurun の event stream 解析開始
     * stream に問題が発生した場合は this.isEventStreamAlive が false になる
     */
    private async startEventStreamAnalysis(): Promise<void> {
        while (true) {
            try {
                this.log.system.info('trying to connecting to the mirakurun');
                await this.updateManage.start();
            } catch (err: any) {
                this.log.system.error('destroy event stream');
                this.retryCount++;
                const retryInterval = Math.min(this.retryCount * 5 * 1000, 60 * 1000);
                await Util.sleep(retryInterval);
            }
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
