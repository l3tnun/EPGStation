
import DBOperator from './DB/DBOperator';
import { EncodedDBInterface } from './DB/EncodedDB';
import MySQLMigrationV1 from './DB/MySQL/migrate/MySQLMigrationV1';
import MySQLMigrationV2 from './DB/MySQL/migrate/MySQLMigrationV2';
import MySQLMigrationV3 from './DB/MySQL/migrate/MySQLMigrationV3';
import MySQLMigrationV4 from './DB/MySQL/migrate/MySQLMigrationV4';
import MySQLMigrationV5 from './DB/MySQL/migrate/MySQLMigrationV5';
import MySQLMigrationV6 from './DB/MySQL/migrate/MySQLMigrationV6';
import MySQLMigrationV7 from './DB/MySQL/migrate/MySQLMigrationV7';
import MySQLMigrationV8 from './DB/MySQL/migrate/MySQLMigrationV8';
import MySQLMigrationV9 from './DB/MySQL/migrate/MySQLMigrationV9';
import MySQLEncodedDB from './DB/MySQL/MySQLEncodedDB';
import MySQLOperator from './DB/MySQL/MySQLOperator';
import MySQLProgramsDB from './DB/MySQL/MySQLProgramsDB';
import MySQLRecordedDB from './DB/MySQL/MySQLRecordedDB';
import MySQLRecordedHistoryDB from './DB/MySQL/MySQLRecordedHistoryDB';
import MySQLRulesDB from './DB/MySQL/MySQLRulesDB';
import MySQLServicesDB from './DB/MySQL/MySQLServicesDB';
import PostgreSQLMigrationV1 from './DB/PostgreSQL/migrate/PostgreSQLMigrationV1';
import PostgreSQLMigrationV2 from './DB/PostgreSQL/migrate/PostgreSQLMigrationV2';
import PostgreSQLMigrationV3 from './DB/PostgreSQL/migrate/PostgreSQLMigrationV3';
import PostgreSQLMigrationV4 from './DB/PostgreSQL/migrate/PostgreSQLMigrationV4';
import PostgreSQLMigrationV5 from './DB/PostgreSQL/migrate/PostgreSQLMigrationV5';
import PostgreSQLMigrationV6 from './DB/PostgreSQL/migrate/PostgreSQLMigrationV6';
import PostgreSQLMigrationV7 from './DB/PostgreSQL/migrate/PostgreSQLMigrationV7';
import PostgreSQLMigrationV8 from './DB/PostgreSQL/migrate/PostgreSQLMigrationV8';
import PostgreSQLMigrationV9 from './DB/PostgreSQL/migrate/PostgreSQLMigrationV9';
import PostgreSQLEncodedDB from './DB/PostgreSQL/PostgreSQLEncodedDB';
import PostgreSQLOperator from './DB/PostgreSQL/PostgreSQLOperator';
import PostgreSQLProgramsDB from './DB/PostgreSQL/PostgreSQLProgramsDB';
import PostgreSQLRecordedDB from './DB/PostgreSQL/PostgreSQLRecordedDB';
import PostgreSQLRecordedHistoryDB from './DB/PostgreSQL/PostgreSQLRecordedHistoryDB';
import PostgreSQLRulesDB from './DB/PostgreSQL/PostgreSQLRulesDB';
import PostgreSQLServicesDB from './DB/PostgreSQL/PostgreSQLServicesDB';
import { ProgramsDBInterface } from './DB/ProgramsDB';
import { RecordedDBInterface } from './DB/RecordedDB';
import { RecordedHistoryDBInterface } from './DB/RecordedHistoryDB';
import { RulesDBInterface } from './DB/RulesDB';
import { ServicesDBInterface } from './DB/ServicesDB';
import SQLite3MigrationV1 from './DB/SQLite3/migrate/SQLite3MigrationV1';
import SQLite3MigrationV2 from './DB/SQLite3/migrate/SQLite3MigrationV2';
import SQLite3MigrationV3 from './DB/SQLite3/migrate/SQLite3MigrationV3';
import SQLite3MigrationV4 from './DB/SQLite3/migrate/SQLite3MigrationV4';
import SQLite3MigrationV5 from './DB/SQLite3/migrate/SQLite3MigrationV5';
import SQLite3MigrationV6 from './DB/SQLite3/migrate/SQLite3MigrationV6';
import SQLite3MigrationV7 from './DB/SQLite3/migrate/SQLite3MigrationV7';
import SQLite3MigrationV8 from './DB/SQLite3/migrate/SQLite3MigrationV8';
import SQLite3MigrationV9 from './DB/SQLite3/migrate/SQLite3MigrationV9';
import SQLite3EncodedDB from './DB/SQLite3/SQLite3EncodedDB';
import SQLite3Operator from './DB/SQLite3/SQLite3Operator';
import SQLite3ProgramsDB from './DB/SQLite3/SQLite3ProgramsDB';
import SQLite3RecordedDB from './DB/SQLite3/SQLite3RecordedDB';
import SQLite3RecordedHistoryDB from './DB/SQLite3/SQLite3RecordedHistoryDB';
import SQLite3RulesDB from './DB/SQLite3/SQLite3RulesDB';
import SQLite3ServicesDB from './DB/SQLite3/SQLite3ServicesDB';

import { IPCServer } from './IPC/IPCServer';
import factory from './ModelFactory';

import EPGUpdateFinModel from './Operator/Callbacks/EPGUpdateFinModel';
import RecordingFailedModel from './Operator/Callbacks/RecordingFailedModel';
import RecordingFinModel from './Operator/Callbacks/RecordingFinModel';
import RecordingPrepRecFailedModel from './Operator/Callbacks/RecordingPrepRecFailedModel';
import RecordingPreStartModel from './Operator/Callbacks/RecordingPreStartModel';
import RecordingStartModel from './Operator/Callbacks/RecordingStartModel';
import ReservationAddedModel from './Operator/Callbacks/ReservationAddedModel';
import RuleUpdateFinModel from './Operator/Callbacks/RuleUpdateFinModel';
import ThumbnailCreateFinModel from './Operator/Callbacks/ThumbnailCreateFinModel';
import { DBInitializationModel } from './Operator/DBInitializationModel';
import { MirakurunManageModel } from './Operator/EPGUpdate/MirakurunManageModel';
import { ProgramExternalProcessModel } from './Operator/ProgramExternalProcessModel';
import { RecordedManageModel } from './Operator/Recorded/RecordedManageModel';
import { RecordedExternalProcessModel } from './Operator/RecordedExternalProcessModel';
import { RecordingManageModel } from './Operator/Recording/RecordingManageModel';
import { RecordingStreamCreator } from './Operator/Recording/RecordingStreamCreator';
import { TSCheckerModel } from './Operator/Recording/TSCheckerModel';
import { ReservationManageModel } from './Operator/Reservation/ReservationManageModel';
import { RuleManageModel } from './Operator/Rule/RuleManageModel';
import { StorageCheckManageModel } from './Operator/Storage/StorageCheckManageModel';
import { ThumbnailManageModel } from './Operator/Thumbnail/ThumbnailManageModel';

import Util from '../Util/Util';

/**
 * Model 設定
 */
namespace ModelFactorySetting {
    /**
     * Model をセットする
     */
    export const init = (): void => {
        // set DB Models
        let operator: DBOperator;
        let servicesDB: ServicesDBInterface;
        let programsDB: ProgramsDBInterface;
        let rulesDB: RulesDBInterface;
        let recordedDB: RecordedDBInterface;
        let encodedDB: EncodedDBInterface;
        let recordedHistoryDB: RecordedHistoryDBInterface;

        switch (Util.getDBType()) {
            case 'mysql':
                operator = new MySQLOperator();
                servicesDB = new MySQLServicesDB(operator);
                programsDB = new MySQLProgramsDB(operator);
                rulesDB = new MySQLRulesDB(operator);
                recordedDB = new MySQLRecordedDB(operator);
                encodedDB = new MySQLEncodedDB(operator);
                recordedHistoryDB = new MySQLRecordedHistoryDB(operator);
                factory.reg('MigrationV1', () => { return new MySQLMigrationV1(operator); });
                factory.reg('MigrationV2', () => { return new MySQLMigrationV2(operator); });
                factory.reg('MigrationV3', () => { return new MySQLMigrationV3(operator); });
                factory.reg('MigrationV4', () => { return new MySQLMigrationV4(operator); });
                factory.reg('MigrationV5', () => { return new MySQLMigrationV5(operator); });
                factory.reg('MigrationV6', () => { return new MySQLMigrationV6(operator); });
                factory.reg('MigrationV7', () => { return new MySQLMigrationV7(operator); });
                factory.reg('MigrationV8', () => { return new MySQLMigrationV8(operator); });
                factory.reg('MigrationV9', () => { return new MySQLMigrationV9(operator); });
                break;

            case 'sqlite3':
                operator = new SQLite3Operator();
                servicesDB = new SQLite3ServicesDB(operator);
                programsDB = new SQLite3ProgramsDB(operator);
                rulesDB = new SQLite3RulesDB(operator);
                recordedDB = new SQLite3RecordedDB(operator);
                encodedDB = new SQLite3EncodedDB(operator);
                recordedHistoryDB = new SQLite3RecordedHistoryDB(operator);
                factory.reg('MigrationV1', () => { return new SQLite3MigrationV1(operator); });
                factory.reg('MigrationV2', () => { return new SQLite3MigrationV2(operator); });
                factory.reg('MigrationV3', () => { return new SQLite3MigrationV3(operator); });
                factory.reg('MigrationV4', () => { return new SQLite3MigrationV4(operator); });
                factory.reg('MigrationV5', () => { return new SQLite3MigrationV5(operator); });
                factory.reg('MigrationV6', () => { return new SQLite3MigrationV6(operator); });
                factory.reg('MigrationV7', () => { return new SQLite3MigrationV7(operator); });
                factory.reg('MigrationV8', () => { return new SQLite3MigrationV8(operator); });
                factory.reg('MigrationV9', () => { return new SQLite3MigrationV9(operator); });
                break;

            case 'postgresql':
                operator = new PostgreSQLOperator();
                servicesDB = new PostgreSQLServicesDB(operator);
                programsDB = new PostgreSQLProgramsDB(operator);
                rulesDB = new PostgreSQLRulesDB(operator);
                recordedDB = new PostgreSQLRecordedDB(operator);
                encodedDB = new PostgreSQLEncodedDB(operator);
                recordedHistoryDB = new PostgreSQLRecordedHistoryDB(operator);
                factory.reg('MigrationV1', () => { return new PostgreSQLMigrationV1(operator); });
                factory.reg('MigrationV2', () => { return new PostgreSQLMigrationV2(operator); });
                factory.reg('MigrationV3', () => { return new PostgreSQLMigrationV3(operator); });
                factory.reg('MigrationV4', () => { return new PostgreSQLMigrationV4(operator); });
                factory.reg('MigrationV5', () => { return new PostgreSQLMigrationV5(operator); });
                factory.reg('MigrationV6', () => { return new PostgreSQLMigrationV6(operator); });
                factory.reg('MigrationV7', () => { return new PostgreSQLMigrationV7(operator); });
                factory.reg('MigrationV8', () => { return new PostgreSQLMigrationV8(operator); });
                factory.reg('MigrationV9', () => { return new PostgreSQLMigrationV9(operator); });
                break;
        }

        // set Operator Manage Models
        const dbInitializationModel = new DBInitializationModel(
            servicesDB!,
            programsDB!,
            rulesDB!,
            recordedDB!,
            encodedDB!,
            recordedHistoryDB!,
        );
        const ipc = new IPCServer();
        const reservationManage = new ReservationManageModel(
            programsDB!,
            rulesDB!,
            servicesDB!,
            ipc,
        );
        const recordingStreamCreator = new RecordingStreamCreator();
        const recordingManage = new RecordingManageModel(
            recordedDB!,
            servicesDB!,
            programsDB!,
            recordedHistoryDB!,
            reservationManage,
            recordingStreamCreator,
            () => { return new TSCheckerModel(); },
        );
        reservationManage.setRecordedManageModel(recordingManage);

        const mirakurunManage = new MirakurunManageModel();
        const thumbnailManageModel = new ThumbnailManageModel(encodedDB!);
        const recordedManage = new RecordedManageModel(
            recordedDB!,
            encodedDB!,
            servicesDB!,
            recordingManage,
            thumbnailManageModel,
        );
        const ruleManageModel = new RuleManageModel(rulesDB!);
        const storageCheckManageModel = new StorageCheckManageModel(
            recordedDB!,
            recordedManage,
            ipc,
        );
        const epgUpdateFinModel = new EPGUpdateFinModel(
            mirakurunManage,
            recordingStreamCreator,
            reservationManage,
            recordedHistoryDB!,
        );
        const ruleUpdateFinModel = new RuleUpdateFinModel(
            reservationManage,
            recordingManage,
            recordedManage,
            ruleManageModel,
        );
        const recordedExternalProcess = new RecordedExternalProcessModel(servicesDB!);
        const programExternalProcessModel = new ProgramExternalProcessModel(servicesDB!);
        const recordingPrepRecFailedModel = new RecordingPrepRecFailedModel(
            recordingManage,
            programExternalProcessModel,
        );
        const recordingPreStartModel = new RecordingPreStartModel(
            recordingManage,
            programExternalProcessModel,
            ipc,
        );
        const recordingStartModel = new RecordingStartModel(
            recordingManage,
            recordedExternalProcess,
            ipc,
        );
        const reservationAddModel = new ReservationAddedModel(
            reservationManage,
            programExternalProcessModel,
        );
        const recordingFinModel = new RecordingFinModel(
            recordingManage,
            thumbnailManageModel,
            recordedExternalProcess,
            ipc,
        );
        const recordingFailedModel = new RecordingFailedModel(
            recordingManage,
            recordedExternalProcess,
        );
        const thumbnailCreateFinModel = new ThumbnailCreateFinModel(
            recordedManage,
            thumbnailManageModel,
            ipc,
        );

        ipc.setModels(
            mirakurunManage,
            reservationManage,
            recordingManage,
            recordedManage,
            ruleManageModel,
        );

        // reg
        factory.reg('ServicesDB', () => { return servicesDB; });
        factory.reg('ProgramsDB', () => { return programsDB; });
        factory.reg('RulesDB', () => { return rulesDB; });
        factory.reg('RecordedDB', () => { return recordedDB; });
        factory.reg('EncodedDB', () => { return encodedDB; });
        factory.reg('RecordedHistoryDB', () => { return recordedHistoryDB; });
        factory.reg('DBInitializationModel', () => { return dbInitializationModel; });
        factory.reg('MirakurunManageModel', () => { return mirakurunManage; });
        factory.reg('ReservationManageModel', () => { return reservationManage; });
        factory.reg('RecordingManageModel', () => { return recordingManage; });
        factory.reg('RecordedManageModel', () => { return recordedManage; });
        factory.reg('RuleManageModel', () => { return ruleManageModel; });
        factory.reg('StorageCheckManageModel', () => { return storageCheckManageModel; });
        factory.reg('ThumbnailManageModel', () => { return thumbnailManageModel; });
        factory.reg('IPCServer', () => { return ipc; });
        factory.reg('EPGUpdateFinModel', () => { return epgUpdateFinModel; });
        factory.reg('RuleUpdateFinModel', () => { return ruleUpdateFinModel; });
        factory.reg('RecordingPrepRecFailedModel', () => { return recordingPrepRecFailedModel; });
        factory.reg('RecordingPreStartModel', () => { return recordingPreStartModel; });
        factory.reg('RecordingStartModel', () => { return recordingStartModel; });
        factory.reg('ReservationAddedModel', () => { return reservationAddModel; });
        factory.reg('RecordingFinModel', () => { return recordingFinModel; });
        factory.reg('RecordingFailedModel', () => { return recordingFailedModel; });
        factory.reg('ThumbnailCreateFinModel', () => { return thumbnailCreateFinModel; });
    };
}

export default ModelFactorySetting;

