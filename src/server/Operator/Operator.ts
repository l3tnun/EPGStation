import Base from '../Base';
import factory from '../Model/ModelFactory';
import { DBInitializationModelInterface } from '../Model/Operator/DBInitializationModel';
import { MirakurunManageModelInterface } from '../Model/Operator/EPGUpdate/MirakurunManageModel';
import { ReservationManageModelInterface } from '../Model/Operator/Reservation/ReservationManageModel';
import { RecordingManageModelInterface } from '../Model/Operator/Recording/RecordingManageModel';
import { ThumbnailManageModelInterface } from '../Model/Operator/Thumbnail/ThumbnailManageModel';
import { StorageCheckManageModelInterface } from '../Model/Operator/Storage/StorageCheckManageModel'
import { IPCServerInterface } from '../Model/IPC/IPCServer';
import { EPGUpdateFinModelInterface } from '../Model/Operator/Callbacks/EPGUpdateFinModel';
import { RuleUpdateFinModelInterface } from '../Model/Operator/Callbacks/RuleUpdateFinModel';
import { RecordingStartModelInterface } from '../Model/Operator/Callbacks/RecordingStartModel';
import { RecordingFinModelInterface } from '../Model/Operator/Callbacks/RecordingFinModel';

/**
* Operator
*/
class Operator extends Base {
    private reservationManage: ReservationManageModelInterface;
    private mirakurunManage: MirakurunManageModelInterface;
    private recordingManage: RecordingManageModelInterface;
    private thumbnailManage: ThumbnailManageModelInterface;
    private ipc: IPCServerInterface;
    private storageCheckManage: StorageCheckManageModelInterface;
    private epgUpdateFinModel: EPGUpdateFinModelInterface;
    private ruleUpdateFinModel: RuleUpdateFinModelInterface;
    private recordingStartModel: RecordingStartModelInterface;
    private recordingFinModel: RecordingFinModelInterface;

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
        this.ipc = <IPCServerInterface>factory.get('IPCServer');

        // DB init
        (<DBInitializationModelInterface>factory.get('DBInitializationModel')).run();

        this.mirakurunManage = <MirakurunManageModelInterface>factory.get('MirakurunManageModel');
        this.reservationManage = <ReservationManageModelInterface>factory.get('ReservationManageModel');
        this.recordingManage = <RecordingManageModelInterface>factory.get('RecordingManageModel');
        this.thumbnailManage = <ThumbnailManageModelInterface>factory.get('ThumbnailManageModel');
        this.storageCheckManage = <StorageCheckManageModelInterface>factory.get('StorageCheckManageModel');
        this.epgUpdateFinModel = <EPGUpdateFinModelInterface>factory.get('EPGUpdateFinModel');
        this.ruleUpdateFinModel = <RuleUpdateFinModelInterface>factory.get('RuleUpdateFinModel');
        this.recordingStartModel = <RecordingStartModelInterface>factory.get('RecordingStartModel');
        this.recordingFinModel = <RecordingFinModelInterface>factory.get('RecordingFinModel');

        //addListener
        this.epgUpdateFinModel.set();
        this.ruleUpdateFinModel.set();
        this.recordingStartModel.set();
        this.recordingFinModel.set();
        this.thumbnailManage.addListener((id, thumbnailPath) => { this.thumbnailCreateCallback(id, thumbnailPath); });
    }

    /**
    * サムネイル生成完了時の callback
    * @param recordedId: recorded id
    * @param thumbnailPath: thumbnail file path
    */
    private async thumbnailCreateCallback(recordedId: number, thumbnailPath: string): Promise<void> {
        try {
            await this.recordingManage.addThumbnail(recordedId, thumbnailPath);

            // socket.io で通知
            this.ipc.notifIo();
        } catch(err) {
            this.log.system.error(err);
        }
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

