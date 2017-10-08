import * as path from 'path';
import * as apid from '../../../node_modules/mirakurun/api';
import { LoggerInterface, Logger } from '../Logger';
import Configuration from '../Configuration';
import Util from '../Util/Util';

import ModelFactorySetting from '../Model/OperatorModelFactorySetting';
import ModelFactory from '../Model/ModelFactory';
import DBBase from '../Model/DB/DBBase';
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

import Mirakurun from 'mirakurun';
import CreateMirakurunClient from '../Util/CreateMirakurunClient';

/**
* Operator
*/
class Operator {
    private config: Configuration;
    private log: LoggerInterface;
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
        Logger.initialize(path.join(__dirname, '..', '..', '..', 'config', 'operatorLogConfig.json'));
        Configuration.getInstance().initialize(path.join(__dirname, '..', '..', '..', 'config', 'config.json'));
        this.log = Logger.getLogger();
        this.config = Configuration.getInstance();

        ModelFactorySetting.init();

        process.on('uncaughtException', (error: Error) => {
            this.log.system.fatal(`uncaughtException: ${ error }`);
        });

        process.on('unhandledRejection', console.dir);
    }

    /**
    * 初期設定
    */
    private async init(): Promise<void> {
        let programsDB = <ProgramsDBInterface>(ModelFactory.get('ProgramsDB'));
        let rulesDB = <RulesDBInterface>(ModelFactory.get('RulesDB'));
        let recordedDB = <RecordedDBInterface>(ModelFactory.get('RecordedDB'));
        let encodedDB = <EncodedDBInterface>(ModelFactory.get('EncodedDB'));
        let servicesDB = <ServicesDBInterface>(ModelFactory.get('ServicesDB'));
        this.ipc = <IPCServerInterface>(ModelFactory.get('IPCServer'));
        this.externalProcess = <ExternalProcessModelInterface>(ModelFactory.get('ExternalProcessModel'))

        try {
            // DB table 作成
            await rulesDB.create()
            this.log.system.info('RulesDB create');

            await recordedDB.create();
            this.log.system.info('RecordedDB create');

            await encodedDB.create();
            this.log.system.info('EncodedDB create');

            await recordedDB.removeAllRecording();
        } catch(err) {
            this.log.system.error('DB create error');
            this.log.system.error(err);
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

        // socket.io で通知
        this.ipc.notifIo();

        if(Util.isContinuousEPGUpdater()) {
            // EPG ストリーム更新開始
            await this.mirakurunEPGUpdateManager.start();
        }
    }

    /**
    * RuleManager Update 終了の callback
    * @param ruleId: rule id
    * @param status: RuleEventStatus
    */
    private async ruleManagerUpdateCallback(ruleId: number, status: RuleEventStatus): Promise<void> {
        // ルールが削除 or 無効化されたとき、そのルールの予約を停止する
        if(status === 'delete' || status === 'disable') {
            this.recordingManager.stopRuleId(ruleId);
        }

        // ルールが削除されたとき recorded の整合性をとる
        if(status === 'delete') {
            try {
                await this.recordingManager.deleteRule(ruleId);
            } catch(err) {
                this.log.system.error(err);
            }
        }

        // ルールが更新されたので予約を更新する
        try {
            await this.reservationManager.updateAll();
        } catch(err) {
            this.log.system.error('ReservationManager update Error');
            this.log.system.error(err);
            setTimeout(() => { this.ruleManagerUpdateCallback(ruleId, status) }, 1000);
        }

        // socket.io で通知
        this.ipc.notifIo();
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
                    filePath: program.recPath,
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
        let cmd = this.config.getConfig().recordedEndCommand;
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
    * mirakurun が起動するのを待つ
    * @param mirakurun: Mirakurun
    */
    private async waitMirakurun(mirakurun: Mirakurun): Promise<void> {
        try {
            await mirakurun.getStatus();
        } catch(err) {
            this.log.system.info('wait mirakurun');
            await Util.sleep(1000);
            return await this.waitMirakurun(mirakurun);
        }
    }

    /**
    * wait db
    */
    private async waitDB(db: DBBase): Promise<void> {
        try {
            await db.ping();
        } catch(err) {
            this.log.system.info('wait DB');
            await Util.sleep(5000);
            await this.waitDB(db);
        }
    }

    /**
    * run
    */
    public async run(): Promise<void> {
        // wait
        await this.waitMirakurun(CreateMirakurunClient.get());
        await this.waitDB(<ProgramsDBInterface>(ModelFactory.get('ProgramsDB')));

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

