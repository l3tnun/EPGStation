import * as apid from '../../../node_modules/mirakurun/api';
import Base from '../Base';
import Util from '../Util/Util';
import ModelFactory from '../Model/ModelFactory';
import { ProgramsDBInterface } from '../Model/DB/ProgramsDB';
import { RulesDBInterface } from '../Model/DB/RulesDB';
import { RecordedDBInterface } from '../Model/DB/RecordedDB';
import { EncodedDBInterface } from '../Model/DB/EncodedDB';
import { ServicesDBInterface } from '../Model/DB/ServicesDB';
import * as DBSchema from '../Model/DB/DBSchema';
import { MirakurunManager } from './MirakurunManager';
import { MirakurunEPGUpdateManager } from './MirakurunEPGUpdateManager';
import { RuleEventStatus, RuleManager } from './RuleManager';
import { ReservationManager } from './ReservationManager';
import { RecordingManager } from './RecordingManager';
import { ThumbnailManager } from './ThumbnailManager';
import { EncodeInterface } from './RuleInterface';
import { IPCServerInterface } from '../Model/IPC/IPCServer';
import { ExternalProcessModelInterface } from '../Model/ExternalProcessModel';
import { StorageCheckManager } from './StorageCheckManager'

/**
* Operator
*/
class Operator extends Base {
    private reservationManager: ReservationManager;
    private ruleManager: RuleManager;
    private mirakurun: MirakurunManager;
    private mirakurunEPGUpdateManager: MirakurunEPGUpdateManager;
    private recordingManager: RecordingManager;
    private thumbnailManager: ThumbnailManager;
    private ipc: IPCServerInterface;
    private externalProcess: ExternalProcessModelInterface;
    private storageCheckManager: StorageCheckManager;

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
        let servicesDB = <ServicesDBInterface>(ModelFactory.get('ServicesDB'));
        let programsDB = <ProgramsDBInterface>(ModelFactory.get('ProgramsDB'));
        let rulesDB = <RulesDBInterface>(ModelFactory.get('RulesDB'));
        let recordedDB = <RecordedDBInterface>(ModelFactory.get('RecordedDB'));
        let encodedDB = <EncodedDBInterface>(ModelFactory.get('EncodedDB'));
        this.ipc = <IPCServerInterface>(ModelFactory.get('IPCServer'));
        this.externalProcess = <ExternalProcessModelInterface>(ModelFactory.get('ExternalProcessModel'))

        try {
            // DB table 作成
            await servicesDB.create();
            this.log.system.info('ServicesDB created');

            await programsDB.create();
            this.log.system.info('ProgramsDB created');

            await rulesDB.create()
            this.log.system.info('RulesDB created');

            await recordedDB.create();
            this.log.system.info('RecordedDB created');

            await encodedDB.create();
            this.log.system.info('EncodedDB created');

            await recordedDB.removeAllRecording();
            await recordedDB.updateAllNullFileSize();
            await encodedDB.updateAllNullFileSize();
        } catch(err) {
            this.log.system.fatal('Operator init error');
            this.log.system.fatal(err);
            process.exit(1);
        };

        ReservationManager.init(programsDB, rulesDB, this.ipc);
        RuleManager.init(rulesDB);
        this.ruleManager = RuleManager.getInstance();
        this.mirakurun = MirakurunManager.getInstance();
        MirakurunEPGUpdateManager.init(servicesDB, programsDB);
        this.mirakurunEPGUpdateManager = MirakurunEPGUpdateManager.getInstance();
        this.reservationManager = ReservationManager.getInstance();
        RecordingManager.init(recordedDB, encodedDB, servicesDB, programsDB, this.reservationManager);
        this.recordingManager = RecordingManager.getInstance();
        this.thumbnailManager = ThumbnailManager.getInstance();
        StorageCheckManager.init(recordedDB, this.recordingManager, this.ipc);
        this.storageCheckManager = StorageCheckManager.getInstance();

        // IPCServer に manager をセット
        this.ipc.setManagers({
            reservation: this.reservationManager,
            recording: this.recordingManager,
            rule: this.ruleManager,
            mirakurun: this.mirakurun,
        });

        //終了時に DB 接続を切断
        process.on('exit', () => { programsDB.end(); });

        //addListener
        this.mirakurun.addListener((tuners) => { this.mirakurunUpdateCallback(tuners); });
        this.ruleManager.addListener((id, status) => { this.ruleManagerUpdateCallback(id, status); });
        this.recordingManager.recStartListener((program) => { this.recordingStartCallback(program); });
        this.recordingManager.recEndListener((program, encode) => { this.recordingFinCallback(program, encode); });
        this.thumbnailManager.addListener((id, thumbnailPath) => { this.thumbnailCreateCallback(id, thumbnailPath); });
    }

    /**
    * MirakurunManager Update 終了の callback
    * @param tuners: apid.TunerDevice[]
    */
    private async mirakurunUpdateCallback(tuners: apid.TunerDevice[]): Promise<void> {
        this.reservationManager.setTuners(tuners);

        //すべての予約を更新
        try {
            await this.reservationManager.updateAll();
        } catch(err) {
            this.log.system.error('ReservationManager update Error');
            this.log.system.error(err);

            setTimeout(() => { this.mirakurunUpdateCallback(tuners) }, 1000);
        };

        if(Util.isContinuousEPGUpdater()) {
            // EPG ストリーム更新開始
            await this.mirakurunEPGUpdateManager.start();
        }
    }

    /**
    * RuleManager Update 終了の callback
    * @param ruleId: rule id
    * @param status: RuleEventStatus
    * @param isRetry: true: retry, false: retry ではない
    */
    private async ruleManagerUpdateCallback(ruleId: number, status: RuleEventStatus, isRetry: boolean = false): Promise<void> {
        // ルールが削除 or 無効化されたとき、そのルールの予約を停止する
        if(!isRetry && (status === 'delete' || status === 'disable')) {
            this.recordingManager.stopRuleId(ruleId);
        }

        // ルールが削除されたとき recorded の整合性をとる
        if(!isRetry && status === 'delete') {
            // SQLite3 使用時に正しく動作しないので sleep
            await Util.sleep(100);
            try {
                await this.recordingManager.deleteRule(ruleId);
            } catch(err) {
                this.log.system.error(err);
            }
        }

        // ルールが更新されたので予約を更新する
        try {
            await this.reservationManager.updateRule(ruleId);
        } catch(err) {
            this.log.system.error('ReservationManager update Error');
            this.log.system.error(err);
            setTimeout(() => { this.ruleManagerUpdateCallback(ruleId, status, true) }, 1000);
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
        this.thumbnailManager.push(program);

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
            await this.recordingManager.addThumbnail(recordedId, thumbnailPath);

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
            this.mirakurun.update();
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
        this.reservationManager.clean();

        if(Util.isContinuousEPGUpdater()) {
            // EPG 更新のストリームの受信を開始
            await this.mirakurunEPGUpdateManager.run();
        }

        //DB 初回更新
        this.updateDB();

        //定期的に 予約情報を更新する
        const reservesUpdateIntervalTime = this.config.getConfig().reservesUpdateIntervalTime || 10;
        setInterval(async () => {
            if(Util.isContinuousEPGUpdater()) {
                try {
                    await this.reservationManager.updateAll();
                } catch(err) {
                    this.log.system.error('ReservationManager update Error');
                    this.log.system.error(err);
                }
            } else {
                this.updateDB();
            }
        }, reservesUpdateIntervalTime * 60 * 1000)

        //予約監視
        setInterval(() => {
            this.recordingManager.check(this.reservationManager.getReservesAll());
        }, 1000 * 3);

        let programsDB = <ProgramsDBInterface>(ModelFactory.get('ProgramsDB'));
        setInterval(() => {
            // recrding のゴミを掃除
            this.recordingManager.cleanRecording();
            if(Util.isContinuousEPGUpdater()) {
                // 1 時間以上経過したデータを削除
                programsDB.deleteOldPrograms()
                .catch((err) => {
                    this.log.system.error('old programs delete error');
                    this.log.system.error(err);
                });
            }
        }, 1000 * 60 * 60);

        //ストレージ空き容量チェック
        const storageLimitThreshold = this.config.getConfig().storageLimitThreshold || 0;
        if(storageLimitThreshold > 0) {
            this.checkStorage(60 * 1000, storageLimitThreshold);
        }
    }

    private checkStorage(intervalTime: number, storageLimitThreshold: number): void {
        setTimeout(async () => {
            let intervalTime = await this.storageCheckManager.check(storageLimitThreshold);
            this.checkStorage(intervalTime, storageLimitThreshold);
        }, intervalTime);
    }
}

export default Operator;

