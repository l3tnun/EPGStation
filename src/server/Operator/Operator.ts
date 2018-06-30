import Base from '../Base';
import factory from '../Model/ModelFactory';
import CallbackBaseModelInterface from '../Model/Operator/Callbacks/CallbackBaseModelInterface';
import { DBInitializationModelInterface } from '../Model/Operator/DBInitializationModel';
import { MirakurunManageModelInterface } from '../Model/Operator/EPGUpdate/MirakurunManageModel';
import { RecordingManageModelInterface } from '../Model/Operator/Recording/RecordingManageModel';
import { ReservationManageModelInterface } from '../Model/Operator/Reservation/ReservationManageModel';
import { StorageCheckManageModelInterface } from '../Model/Operator/Storage/StorageCheckManageModel';

/**
 * Operator
 */
class Operator extends Base {
    private reservationManage: ReservationManageModelInterface;
    private mirakurunManage: MirakurunManageModelInterface;
    private recordingManage: RecordingManageModelInterface;
    private storageCheckManage: StorageCheckManageModelInterface;

    constructor() {
        super();

        process.on('uncaughtException', (error: Error) => {
            this.log.system.fatal(`uncaughtException: ${ error }`);
        });

        process.on('unhandledRejection', console.dir);

        this.mirakurunManage = <MirakurunManageModelInterface> factory.get('MirakurunManageModel');
        this.reservationManage = <ReservationManageModelInterface> factory.get('ReservationManageModel');
        this.recordingManage = <RecordingManageModelInterface> factory.get('RecordingManageModel');
        this.storageCheckManage = <StorageCheckManageModelInterface> factory.get('StorageCheckManageModel');
    }

    /**
     * 初期設定
     */
    private async init(): Promise<void> {
        // DB init
        await (<DBInitializationModelInterface> factory.get('DBInitializationModel')).run();

        // set callback
        (<CallbackBaseModelInterface> factory.get('EPGUpdateFinModel')).set();
        (<CallbackBaseModelInterface> factory.get('RuleUpdateFinModel')).set();
        (<CallbackBaseModelInterface> factory.get('ReservationAddedModel')).set();
        (<CallbackBaseModelInterface> factory.get('RecordingPreStartModel')).set();
        (<CallbackBaseModelInterface> factory.get('RecordingPrepRecFailedModel')).set();
        (<CallbackBaseModelInterface> factory.get('RecordingStartModel')).set();
        (<CallbackBaseModelInterface> factory.get('RecordingFinModel')).set();
        (<CallbackBaseModelInterface> factory.get('RecordingFailedModel')).set();
        (<CallbackBaseModelInterface> factory.get('ThumbnailCreateFinModel')).set();
    }

    /**
     * DB 更新
     */
    private updateDB(): void {
        try {
            this.mirakurunManage.update();
        } catch (e) {
            this.log.system.error(e);
        }
    }

    /**
     * run
     */
    public async run(): Promise<void> {
        await this.init();

        // reserves の古い予約を削除しておく
        this.reservationManage.clean();

        // DB 初回更新
        this.updateDB();

        // 定期的に 予約情報を更新する
        const reservesUpdateIntervalTime = this.config.getConfig().reservesUpdateIntervalTime || 10;
        setInterval(async() => {
            this.updateDB();
        }, reservesUpdateIntervalTime * 60 * 1000);

        // 予約監視
        setInterval(() => {
            this.recordingManage.check(this.reservationManage.getReservesAll());
        }, 1000 * 3);

        // recrding のゴミを掃除
        setInterval(() => {
            this.recordingManage.cleanRecording();
        }, 1000 * 60 * 60);

        // ストレージ空き容量チェック
        const storageLimitThreshold = this.config.getConfig().storageLimitThreshold || 0;
        if (storageLimitThreshold > 0) {
            this.checkStorage(60 * 1000, storageLimitThreshold);
        }
    }

    private checkStorage(intervalTime: number, storageLimitThreshold: number): void {
        setTimeout(async() => {
            const time = await this.storageCheckManage.check(storageLimitThreshold);
            this.checkStorage(time, storageLimitThreshold);
        }, intervalTime);
    }
}

export default Operator;

