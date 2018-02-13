import Base from '../Base';
import factory from '../Model/ModelFactory';
import { DBInitializationModelInterface } from '../Model/Operator/DBInitializationModel';
import { MirakurunManageModelInterface } from '../Model/Operator/EPGUpdate/MirakurunManageModel';
import { ReservationManageModelInterface } from '../Model/Operator/Reservation/ReservationManageModel';
import { RecordingManageModelInterface } from '../Model/Operator/Recording/RecordingManageModel';
import { StorageCheckManageModelInterface } from '../Model/Operator/Storage/StorageCheckManageModel'
import { EPGUpdateFinModelInterface } from '../Model/Operator/Callbacks/EPGUpdateFinModel';
import { RuleUpdateFinModelInterface } from '../Model/Operator/Callbacks/RuleUpdateFinModel';
import { RecordingStartModelInterface } from '../Model/Operator/Callbacks/RecordingStartModel';
import { RecordingFinModelInterface } from '../Model/Operator/Callbacks/RecordingFinModel';
import { ThumbnailCreateFinModelInterface } from '../Model/Operator/Callbacks/ThumbnailCreateFinModel';

/**
* Operator
*/
class Operator extends Base {
    private reservationManage: ReservationManageModelInterface;
    private mirakurunManage: MirakurunManageModelInterface;
    private recordingManage: RecordingManageModelInterface;
    private storageCheckManage: StorageCheckManageModelInterface;
    private epgUpdateFinModel: EPGUpdateFinModelInterface;
    private ruleUpdateFinModel: RuleUpdateFinModelInterface;
    private recordingStartModel: RecordingStartModelInterface;
    private recordingFinModel: RecordingFinModelInterface;
    private thumbnailCreateFinModel: ThumbnailCreateFinModelInterface;

    constructor() {
        super();

        process.on('uncaughtException', (error: Error) => {
            this.log.system.fatal(`uncaughtException: ${ error }`);
        });

        process.on('unhandledRejection', console.dir);
    }

    /**
    * 初期設定
    */
    private async init(): Promise<void> {
        // DB init
        (<DBInitializationModelInterface>factory.get('DBInitializationModel')).run();

        this.mirakurunManage = <MirakurunManageModelInterface>factory.get('MirakurunManageModel');
        this.reservationManage = <ReservationManageModelInterface>factory.get('ReservationManageModel');
        this.recordingManage = <RecordingManageModelInterface>factory.get('RecordingManageModel');
        this.storageCheckManage = <StorageCheckManageModelInterface>factory.get('StorageCheckManageModel');
        this.epgUpdateFinModel = <EPGUpdateFinModelInterface>factory.get('EPGUpdateFinModel');
        this.ruleUpdateFinModel = <RuleUpdateFinModelInterface>factory.get('RuleUpdateFinModel');
        this.recordingStartModel = <RecordingStartModelInterface>factory.get('RecordingStartModel');
        this.recordingFinModel = <RecordingFinModelInterface>factory.get('RecordingFinModel');
        this.thumbnailCreateFinModel = <ThumbnailCreateFinModelInterface>factory.get('ThumbnailCreateFinModel');

        this.epgUpdateFinModel.set();
        this.ruleUpdateFinModel.set();
        this.recordingStartModel.set();
        this.recordingFinModel.set();
        this.thumbnailCreateFinModel.set();
    }

    /**
    * DB 更新
    */
    private updateDB(): void {
        try {
            this.mirakurunManage.update();
        } catch(e) {
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

        //DB 初回更新
        this.updateDB();

        //定期的に 予約情報を更新する
        const reservesUpdateIntervalTime = this.config.getConfig().reservesUpdateIntervalTime || 10;
        setInterval(async () => {
            this.updateDB();
        }, reservesUpdateIntervalTime * 60 * 1000)

        //予約監視
        setInterval(() => {
            this.recordingManage.check(this.reservationManage.getReservesAll());
        }, 1000 * 3);

        // recrding のゴミを掃除
        setInterval(() => {
            this.recordingManage.cleanRecording();
        }, 1000 * 60 * 60);

        //ストレージ空き容量チェック
        const storageLimitThreshold = this.config.getConfig().storageLimitThreshold || 0;
        if(storageLimitThreshold > 0) {
            this.checkStorage(60 * 1000, storageLimitThreshold);
        }
    }

    private checkStorage(intervalTime: number, storageLimitThreshold: number): void {
        setTimeout(async () => {
            let intervalTime = await this.storageCheckManage.check(storageLimitThreshold);
            this.checkStorage(intervalTime, storageLimitThreshold);
        }, intervalTime);
    }
}

export default Operator;

