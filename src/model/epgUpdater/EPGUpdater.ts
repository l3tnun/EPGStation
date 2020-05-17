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
        setInterval(async () => {
            try {
                if (this.isEventStreamAlive === true) {
                    if (this.updateManage.getServiceQueueSize() > 0) {
                        // queue に更新情報が無ければ実行しない
                        await this.updateManage.saveSevice();
                    }
                    if (this.updateManage.getProgramQueueSize() > 0) {
                        // queue に更新情報が無ければ実行しない
                        await this.updateManage.saveProgram();
                    }
                } else {
                    // stream event に何らかの問題が発生した
                    this.startEventStreamAnalysis();
                    await this.updateManage.updateAll();
                }

                this.notify();
            } catch (err) {
                this.log.system.error('EPG update error');
                this.log.system.error(err);
            }

            // 古い番組情報を削除
            this.log.system.info('delete old programs');
            await this.updateManage.deleteOldPrograms().catch(err => {
                this.log.system.error('delete orld programs error');
                this.log.system.error(err);
            });
        }, updateTime * 60 * 1000);
    }

    /**
     * mirakurun の event stream 解析開始
     * stream に問題が発生した場合は this.isEventStreamAlive が false になる
     */
    private async startEventStreamAnalysis(): Promise<void> {
        this.isEventStreamAlive = true;
        try {
            await this.updateManage.start();
        } catch (err) {
            this.log.system.error('destory event stream');
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
