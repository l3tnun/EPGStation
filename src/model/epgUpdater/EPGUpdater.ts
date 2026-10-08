import { inject, injectable } from 'inversify';
import IConfigFile from '../IConfigFile.js';
import IConfiguration from '../IConfiguration.js';
import ILogger from '../ILogger.js';
import ILoggerModel from '../ILoggerModel.js';
import IEPGUpdateManageModel, { EPGUpdateEvent } from './IEPGUpdateManageModel.js';
import IEPGUpdater from './IEPGUpdater.js';
import Util from '../../util/Util.js';

/** イベントストリーム再接続1回分の全件再同期要求。処理される前にストリームが再度切断
 *  された場合、`aborted`が`true`になり、同期完了後も`isEventStreamAlive`を立てさせない。 */
interface StreamSynchronizationRequest {
    aborted: boolean;
}

/**
 * `IEPGUpdater` の実装。チューナーサーバーのイベントストリーム（接続中は差分を都度反映）と、
 * 定期ポーリング（`epgUpdateIntervalTime`間隔、イベントストリームが繋がっていない間の
 * フォールバック）を組み合わせてEPGを更新し続ける。更新処理そのものは
 * `IEPGUpdateManageModel`へ委譲する。
 */
@injectable()
class EPGUpdater implements IEPGUpdater {
    private log: ILogger;
    private config: IConfigFile;
    private updateManage: IEPGUpdateManageModel;

    /** チューナーサーバーのイベントストリームが現在接続中か。`STREAM_STARTED`後の
     *  再同期完了で`true`、`STREAM_ABORTED`で`false`になる。 */
    private isEventStreamAlive: boolean = false;
    /** 直近で全件更新（`updateManage.updateAll`）を行った時刻。定期ポーリングが
     *  再実行すべきかの判定に使う。 */
    private lastUpdatedTime: number = 0;
    /** 直近で古い番組情報の削除（`updateManage.deleteOldPrograms`）を行った時刻。 */
    private lastDeletedTime: number = 0;
    /** イベントストリーム再接続の再試行回数。再接続の待機時間を線形に伸ばすために使い、
     *  再接続成功（`STREAM_STARTED`）のたびに0へ戻る。 */
    private retryCount: number = 0;
    /** 更新サイクル（`runUpdateCycles`）が実行中かどうかを示す実行中フラグ。多重実行を防ぐ。 */
    private isUpdateCycleActive: boolean = false;
    /** 定期ポーリングによる更新サイクルの実行がまだ1回分未処理であることを示す。 */
    private isUpdateCyclePending: boolean = false;
    /** イベントストリーム再接続ごとの全件再同期要求のキュー。1件ずつ順に処理する。 */
    private streamSynchronizationQueue: StreamSynchronizationRequest[] = [];
    /** `streamSynchronizationQueue`に積んだ直近の要求への参照。`STREAM_ABORTED`が
     *  どの要求に対する中断かを識別し、`aborted`フラグを立てるために使う。 */
    private latestStreamSynchronizationRequest: StreamSynchronizationRequest | undefined;

    private static readonly EVENT_STREAM_REONNECTION_MAX = 12;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IEPGUpdateManageModel') updateManage: IEPGUpdateManageModel,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.updateManage = updateManage;

        this.updateManage.on(EPGUpdateEvent.PROGRAM_UPDATED, () => {
            // NOTE this.config.epgUpdateIntervalTime の周期で予約情報を更新させるため無効化
            // this.notify();
        });

        this.updateManage.on(EPGUpdateEvent.SERVICE_UPDATED, () => {
            // NOTE this.config.epgUpdateIntervalTime の周期で予約情報を更新させるため無効化
            // this.notify();
        });

        this.updateManage.on(EPGUpdateEvent.STREAM_STARTED, () => {
            this.log.system.info('event stream started');
            this.retryCount = 0;
            this.requestStreamSynchronization();
        });

        this.updateManage.on(EPGUpdateEvent.STREAM_ABORTED, () => {
            this.log.system.info('has disconnected from the mirakurun');
            if (this.latestStreamSynchronizationRequest !== undefined) {
                this.latestStreamSynchronizationRequest.aborted = true;
            }
            this.isEventStreamAlive = false;
        });
    }

    /**
     * EPG 更新処理開始
     */
    public async start(): Promise<void> {
        this.log.system.info('start EPG update');

        // event streamを開始
        this.startEventStreamAnalysis();

        // 放送中や放送開始時刻が間近の番組は短いサイクルでDBへ保存する
        // NOTE: DB負荷などを考慮しEvent受信と同時のDB反映は見合わせる
        setInterval(() => {
            this.requestUpdateCycle();
        }, 10 * 1000);
    }

    private requestUpdateCycle(): void {
        this.isUpdateCyclePending = true;
        this.startUpdateCycles();
    }

    private requestStreamSynchronization(): void {
        const request: StreamSynchronizationRequest = {
            aborted: false,
        };
        this.latestStreamSynchronizationRequest = request;
        this.streamSynchronizationQueue.push(request);
        this.startUpdateCycles();
    }

    private startUpdateCycles(): void {
        if (this.isUpdateCycleActive === true) {
            return;
        }

        this.isUpdateCycleActive = true;
        void this.runUpdateCycles().catch(err => {
            this.log.system.error('EPG update error');
            this.log.system.error(err);
        });
    }

    private async runUpdateCycles(): Promise<void> {
        try {
            await this.runUpdateCycle();
        } finally {
            const shouldReevaluate = this.hasPendingUpdateCycle();
            this.isUpdateCycleActive = false;
            if (shouldReevaluate === true) {
                this.startUpdateCycles();
            }
        }
    }

    private hasPendingUpdateCycle(): boolean {
        return this.streamSynchronizationQueue.length > 0 || this.isUpdateCyclePending;
    }

    private async runUpdateCycle(): Promise<void> {
        const streamSynchronization = this.streamSynchronizationQueue.shift();
        if (streamSynchronization !== undefined) {
            await this.synchronizeStartedStream(streamSynchronization);
            return;
        }

        this.isUpdateCyclePending = false;
        await this.updatePeriodically();
    }

    private async synchronizeStartedStream(request: StreamSynchronizationRequest): Promise<void> {
        try {
            await this.updateManage.updateAll();
            this.notify();
        } catch (err: any) {
            this.log.system.error('updateAll error');
        }

        // updateAllが完了して以降、queueフラッシュ処理を有効にするために
        // この位置でisEventStreamAliveをtrueにする
        const now = new Date().getTime();
        this.lastUpdatedTime = now;
        // updateAll 後は全件数削除が行われるため削除時間も更新する
        this.lastDeletedTime = now;
        if (request === this.latestStreamSynchronizationRequest && request.aborted === false) {
            this.isEventStreamAlive = true;
        }
    }

    private async updatePeriodically(): Promise<void> {
        const updateInterval = this.config.epgUpdateIntervalTime * 60 * 1000;
        const now = new Date().getTime();

        try {
            if (this.isEventStreamAlive === true) {
                await this.updateTunerChanges(updateInterval, now);
            } else if (this.lastUpdatedTime + updateInterval * 1.5 <= now) {
                await this.updateManage.updateAll();
                this.lastUpdatedTime = now;
                // updateAll 後は全件数削除が行われるため削除時間も更新する
                this.lastDeletedTime = now;
                this.notify();
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

    /**
     * 製品非依存の変更通知を保存する
     * @param updateInterval 更新間隔 (ミリ秒)
     * @param now 現在時刻 (エポックミリ秒)
     */
    private async updateTunerChanges(updateInterval: number, now: number): Promise<void> {
        const isFullUpdate = this.lastUpdatedTime + updateInterval <= now;
        const deferredUpdate = await this.updateMirakcEvent(updateInterval, now);
        try {
            await this.updateMirakurunEventStream(updateInterval, now);

            if (isFullUpdate) {
                this.lastUpdatedTime = now;
                this.notify();
            }
        } finally {
            await deferredUpdate.completion;
        }
    }

    /**
     * mirakurun の event stream 解析開始
     * stream に問題が発生した場合は this.isEventStreamAlive が false になる
     */
    private async startEventStreamAnalysis(): Promise<void> {
        while (true) {
            await this.runEventStreamAttempt();
        }
    }

    private async runEventStreamAttempt(): Promise<void> {
        try {
            this.log.system.info('trying to connecting to the mirakurun');
            await this.updateManage.start();
        } catch (err: any) {
            this.log.system.error('destroy event stream');
            // 失敗した理由そのものも残す。これが無いと tuner server につながらない原因を
            // log から辿れない。
            this.log.system.error(err);

            // スリープ時間が 60 秒を超えないようにチェック
            if (this.retryCount < EPGUpdater.EVENT_STREAM_REONNECTION_MAX) {
                this.retryCount++;
            }
            const retryInterval = this.retryCount * 5 * 1000;
            await Util.sleep(retryInterval);
        }
    }

    /**
     * mirakurun の event stream の解析結果を保存する
     * @param updateInterval: number 更新間隔 (ミリ秒)
     * @param now: 現在時刻 エポックミリ秒
     */
    private async updateMirakurunEventStream(updateInterval: number, now: number): Promise<void> {
        if (this.lastUpdatedTime + updateInterval > now) {
            // updateInterval 分だけ経過するまでは直近の5分間のデータのみ更新する
            await this.updateManage.saveProgram(now + 5 * 60 * 1000).catch(e => {
                this.log.system.error('program update error');
                throw e;
            });
        } else {
            // updateInterval 分だけ経過したのですべてのデータを更新する
            await this.updateManage.saveService().catch(e => {
                this.log.system.error('service update error');
                throw e;
            });
            await this.updateManage.saveProgram().catch(e => {
                this.log.system.error('program update error');
                throw e;
            });
        }
    }

    /**
     * mirakc の /events の解析結果を元に番組情報を更新する
     * @param updateInterval
     * @param now
     */
    private async updateMirakcEvent(updateInterval: number, now: number): Promise<{ completion: Promise<void> }> {
        // 放映中のものはすぐに更新する
        await this.updateManage.saveOnAirServices().catch(e => {
            this.log.system.error('failed to save onair services');
            throw e;
        });

        // 放映中以外の者は updateInterval の間隔で更新する
        if (this.lastUpdatedTime + updateInterval <= now) {
            const completion = this.updateManage.saveUpdateServices().catch(() => {
                this.log.system.error('failed to save update services');
            });
            return { completion };
        }

        return { completion: Promise.resolve() };
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
