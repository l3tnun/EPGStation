import * as apid from '../../../node_modules/mirakurun/api';
import Base from '../Base';
import Util from '../Util/Util';
import factory from '../Model/ModelFactory';
import * as DBSchema from '../Model/DB/DBSchema';
import { DBInitializationModelInterface } from '../Model/Operator/DBInitializationModel';
import { MirakurunManageModelInterface } from '../Model/Operator/EPGUpdate/MirakurunManageModel';
import { RuleEventStatus, RuleManageModelInterface } from '../Model/Operator/Rule/RuleManageModel';
import { ReservationManageModelInterface } from '../Model/Operator/Reservation/ReservationManageModel';
import { RecordingManageModelInterface } from '../Model/Operator/Recording/RecordingManageModel';
import { ThumbnailManageModelInterface } from '../Model/Operator/Thumbnail/ThumbnailManageModel';
import { StorageCheckManageModelInterface } from '../Model/Operator/Storage/StorageCheckManageModel'
import { EncodeInterface } from '../Model/Operator/RuleInterface';
import { IPCServerInterface } from '../Model/IPC/IPCServer';
import { ExternalProcessModelInterface } from '../Model/ExternalProcessModel';

/**
* Operator
*/
class Operator extends Base {
    private reservationManage: ReservationManageModelInterface;
    private ruleManage: RuleManageModelInterface;
    private mirakurunManage: MirakurunManageModelInterface;
    private recordingManage: RecordingManageModelInterface;
    private thumbnailManage: ThumbnailManageModelInterface;
    private ipc: IPCServerInterface;
    private externalProcess: ExternalProcessModelInterface;
    private storageCheckManage: StorageCheckManageModelInterface;

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
        this.externalProcess = <ExternalProcessModelInterface>factory.get('ExternalProcessModel');

        // DB init
        (<DBInitializationModelInterface>factory.get('DBInitializationModel')).run();

        this.ruleManage = <RuleManageModelInterface>factory.get('RuleManageModel');
        this.mirakurunManage = <MirakurunManageModelInterface>factory.get('MirakurunManageModel');
        this.reservationManage = <ReservationManageModelInterface>factory.get('ReservationManageModel');
        this.recordingManage = <RecordingManageModelInterface>factory.get('RecordingManageModel');
        this.thumbnailManage = <ThumbnailManageModelInterface>factory.get('ThumbnailManageModel');
        this.storageCheckManage = <StorageCheckManageModelInterface>factory.get('StorageCheckManageModel');

        //addListener
        this.mirakurunManage.addListener((tuners) => { this.epgUpdateCallback(tuners); });
        this.ruleManage.addListener((id, status) => { this.ruleUpdateCallback(id, status); });
        this.recordingManage.recStartListener((program) => { this.recordingStartCallback(program); });
        this.recordingManage.recEndListener((program, encode) => { this.recordingFinCallback(program, encode); });
        this.thumbnailManage.addListener((id, thumbnailPath) => { this.thumbnailCreateCallback(id, thumbnailPath); });
    }

    /**
    * EPG 更新終了の callback
    * @param tuners: apid.TunerDevice[]
    */
    private async epgUpdateCallback(tuners: apid.TunerDevice[]): Promise<void> {
        this.reservationManage.setTuners(tuners);

        //すべての予約を更新
        try {
            await this.reservationManage.updateAll();
        } catch(err) {
            this.log.system.error('ReservationManage update Error');
            this.log.system.error(err);

            setTimeout(() => { this.epgUpdateCallback(tuners) }, 1000);
        };
    }

    /**
    * ルール更新終了の callback
    * @param ruleId: rule id
    * @param status: RuleEventStatus
    * @param isRetry: true: retry, false: retry ではない
    */
    private async ruleUpdateCallback(ruleId: number, status: RuleEventStatus, isRetry: boolean = false): Promise<void> {
        // ルールが削除 or 無効化されたとき、そのルールの予約を停止する
        if(!isRetry && (status === 'delete' || status === 'disable')) {
            this.recordingManage.stopRuleId(ruleId);
        }

        // ルールが削除されたとき recorded の整合性をとる
        if(!isRetry && status === 'delete') {
            // SQLite3 使用時に正しく動作しないので sleep
            await Util.sleep(100);
            try {
                await this.recordingManage.deleteRule(ruleId);
            } catch(err) {
                this.log.system.error(err);
            }
        }

        // ルールが更新されたので予約を更新する
        try {
            await this.reservationManage.updateRule(ruleId);
        } catch(err) {
            this.log.system.error('ReservationManage update Error');
            this.log.system.error(err);
            setTimeout(() => { this.ruleUpdateCallback(ruleId, status, true) }, 1000);
        }
    }

    /**
    * 録画開始時の callback
    * @param program: DBSchema.RecordedSchema
    */
    private recordingStartCallback(program: DBSchema.RecordedSchema): void {
        // socket.io で通知
        this.ipc.notifIo();

        // 外部コマンド実行
        let cmd = this.config.getConfig().recordedStartCommand;
        if(typeof cmd !== 'undefined') {
            this.externalProcess.run(cmd, program);
        }
    }

    /**
    * 録画完了時の callback
    * @param program: DBSchema.RecordedSchema | null
    * @param encodeOption: EncodeInterface | null
    * program が null の場合は録画中に recorded から削除された
    */
    private async recordingFinCallback(program: DBSchema.RecordedSchema | null, encodeOption: EncodeInterface | null): Promise<void> {
        if(program === null) { return; }

        //サムネイル生成
        this.thumbnailManage.push(program);

        const config = this.config.getConfig();

        // ts 前処理
        if(typeof config.tsModify !== 'undefined' && program.recPath !== null) {
            await this.ipc.setEncode({
                recordedId: program.id,
                source: program.recPath,
                delTs: false,
                recordedProgram: program,
            });
        }

        //エンコード
        if(encodeOption !== null) {
            //エンコードオプションを生成
            let settings: { mode: number, directory?: string }[] = [];
            let encCnt = 0;
            if(typeof encodeOption.mode1 !== 'undefined') {
                settings.push({ mode: encodeOption.mode1, directory: encodeOption.directory1 }); encCnt += 1;
            }
            if(typeof encodeOption.mode2 !== 'undefined') {
                settings.push({ mode: encodeOption.mode2, directory: encodeOption.directory2 }); encCnt += 1;
            }
            if(typeof encodeOption.mode3 !== 'undefined') {
                settings.push({ mode: encodeOption.mode3, directory: encodeOption.directory3 }); encCnt += 1;
            }

            //エンコードを依頼する
            for(let i = 0; i < settings.length; i++) {
                if(program.recPath === null) { continue; }
                await this.ipc.setEncode({
                    recordedId: program.id,
                    source: program.recPath,
                    mode: settings[i].mode,
                    directory: settings[i].directory,
                    delTs: i === encCnt - 1 ? encodeOption.delTs : false,
                    recordedProgram: program,
                });
            }
        }

        // socket.io で通知
        this.ipc.notifIo();

        // 外部コマンド実行
        let cmd = config.recordedEndCommand;
        if(typeof cmd !== 'undefined') {
            this.externalProcess.run(cmd, program);
        }
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

