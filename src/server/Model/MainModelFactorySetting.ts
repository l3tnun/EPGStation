
import DBOperator from './DB/DBOperator';
import { EncodedDBInterface } from './DB/EncodedDB';
import MySQLMigrationV1 from './DB/MySQL/migrate/MySQLMigrationV1';
import MySQLMigrationV2 from './DB/MySQL/migrate/MySQLMigrationV2';
import MySQLEncodedDB from './DB/MySQL/MySQLEncodedDB';
import MySQLOperator from './DB/MySQL/MySQLOperator';
import MySQLProgramsDB from './DB/MySQL/MySQLProgramsDB';
import MySQLRecordedDB from './DB/MySQL/MySQLRecordedDB';
import MySQLRecordedHistoryDB from './DB/MySQL/MySQLRecordedHistoryDB';
import MySQLRulesDB from './DB/MySQL/MySQLRulesDB';
import MySQLServicesDB from './DB/MySQL/MySQLServicesDB';
import PostgreSQLMigrationV1 from './DB/PostgreSQL/migrate/PostgreSQLMigrationV1';
import PostgreSQLMigrationV2 from './DB/PostgreSQL/migrate/PostgreSQLMigrationV2';
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
import ReservationAddModel from './Operator/Callbacks/ReservationAddModel';
import RuleUpdateFinModel from './Operator/Callbacks/RuleUpdateFinModel';
import ThumbnailCreateFinModel from './Operator/Callbacks/ThumbnailCreateFinModel';
import { DBInitializationModel } from './Operator/DBInitializationModel';
import { MirakurunManageModel } from './Operator/EPGUpdate/MirakurunManageModel';
import { ProgramExternalProcessModel } from './Operator/ProgramExternalProcessModel';
import { RecordedManageModel } from './Operator/Recorded/RecordedManageModel';
import { RecordedExternalProcessModel } from './Operator/RecordedExternalProcessModel';
import { RecordingManageModel } from './Operator/Recording/RecordingManageModel';
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
            ipc,
        );
        const recordingManage = new RecordingManageModel(
            recordedDB!,
            servicesDB!,
            programsDB!,
            recordedHistoryDB!,
            reservationManage,
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
        const reservationAddModel = new ReservationAddModel(
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
        factory.reg('ReservationAddModel', () => { return reservationAddModel; });
        factory.reg('RecordingFinModel', () => { return recordingFinModel; });
        factory.reg('RecordingFailedModel', () => { return recordingFailedModel; });
        factory.reg('ThumbnailCreateFinModel', () => { return thumbnailCreateFinModel; });
    };
}

export default ModelFactorySetting;

