import factory from './ModelFactory';
import { ServicesDBInterface } from './DB/ServicesDB';
import { ProgramsDBInterface } from './DB/ProgramsDB';
import { RulesDBInterface } from './DB/RulesDB';
import { RecordedDBInterface } from './DB/RecordedDB';
import { EncodedDBInterface } from './DB/EncodedDB';
import DBOperator from './DB/DBOperator';
import MySQLOperator from './DB/MySQL/MySQLOperator';
import SQLite3Operator from './DB/SQLite3/SQLite3Operator';
import PostgreSQLOperator from './DB/PostgreSQL/PostgreSQLOperator';
import MySQLServicesDB from './DB/MySQL/MySQLServicesDB';
import MySQLProgramsDB from './DB/MySQL/MySQLProgramsDB';
import MySQLRulesDB from './DB/MySQL/MySQLRulesDB';
import MySQLRecordedDB from './DB/MySQL/MySQLRecordedDB';
import MySQLEncodedDB from './DB/MySQL/MySQLEncodedDB';
import SQLite3ServicesDB from './DB/SQLite3/SQLite3ServicesDB';
import SQLite3ProgramsDB from './DB/SQLite3/SQLite3ProgramsDB';
import SQLite3RulesDB from './DB/SQLite3/SQLite3RulesDB';
import SQLite3RecordedDB from './DB/SQLite3/SQLite3RecordedDB';
import SQLite3EncodedDB from './DB/SQLite3/SQLite3EncodedDB';
import PostgreSQLServicesDB from './DB/PostgreSQL/PostgreSQLServicesDB';
import PostgreSQLProgramsDB from './DB/PostgreSQL/PostgreSQLProgramsDB';
import PostgreSQLRulesDB from './DB/PostgreSQL/PostgreSQLRulesDB';
import PostgreSQLRecordedDB from './DB/PostgreSQL/PostgreSQLRecordedDB';
import PostgreSQLEncodedDB from './DB/PostgreSQL/PostgreSQLEncodedDB';
import { RulesModel } from './Api/RulesModel';
import { RecordedModel } from './Api/RecordedModel';
import { ChannelsModel } from './Api/ChannelsModel';
import { ReservesModel } from './Api/ReservesModel';
import { IPCClient } from './IPC/IPCClient';
import { ScheduleModel } from './Api/ScheduleModel';
import { ConfigModel } from './Api/ConfigModel';
import { StorageModel } from './Api/StorageModel';
import { EncodeProcessManageModel } from './Service/Encode/EncodeProcessManageModel';
import { EncodeManageModel } from './Service/Encode/EncodeManageModel';
import { EncodeModel } from './Encode/EncodeModel';
import { StreamsModel } from './Api/StreamsModel';
import { SocketIoManageModel } from './Service/SocketIoManageModel';
import { StreamManageModel } from './Service/Stream/StreamManageModel';
import { MpegTsLiveStream } from './Service/Stream/MpegTsLiveStream';
import { RecordedHLSStream } from './Service/Stream/RecordedHLSStream';
import Util from '../Util/Util';
import * as apid from '../../../api';

/**
* Service 用の Model 設定
*/
namespace ModelFactorySetting {
    /**
    * Model をセットする
    */
    export const init = (): void => {
        let operator: DBOperator;
        let servicesDB: ServicesDBInterface;
        let programsDB: ProgramsDBInterface;
        let rulesDB: RulesDBInterface;
        let recordedDB: RecordedDBInterface;
        let encodedDB: EncodedDBInterface;

        switch (Util.getDBType()) {
            case 'mysql':
                operator = new MySQLOperator();
                servicesDB = new MySQLServicesDB(operator);
                programsDB = new MySQLProgramsDB(operator);
                rulesDB = new MySQLRulesDB(operator);
                recordedDB = new MySQLRecordedDB(operator)
                encodedDB = new MySQLEncodedDB(operator);
                break;

            case 'sqlite3':
                operator = new SQLite3Operator();
                servicesDB = new SQLite3ServicesDB(operator);
                programsDB = new SQLite3ProgramsDB(operator);
                rulesDB = new SQLite3RulesDB(operator);
                recordedDB = new SQLite3RecordedDB(operator)
                encodedDB = new SQLite3EncodedDB(operator);
                break;

            case 'postgresql':
                operator = new PostgreSQLOperator();
                servicesDB = new PostgreSQLServicesDB(operator);
                programsDB = new PostgreSQLProgramsDB(operator);
                rulesDB = new PostgreSQLRulesDB(operator);
                recordedDB = new PostgreSQLRecordedDB(operator)
                encodedDB = new PostgreSQLEncodedDB(operator);
                break;
        }

        const encodeProcessManage = new EncodeProcessManageModel();
        const encodeManage = new EncodeManageModel(encodeProcessManage);

        const socketIoServer = new SocketIoManageModel();
        factory.reg('SocketIoManageModel', () => { return socketIoServer; });

        const encodeModel = new EncodeModel(
            encodeManage,
            socketIoServer,
            recordedDB!,
        );

        const ipc = new IPCClient()
        ipc.setModels(encodeModel, socketIoServer);

        encodeModel.setIPC(ipc);

        const streamManage = new StreamManageModel(socketIoServer);

        factory.reg('RulesModel', () => { return new RulesModel(ipc, rulesDB) });
        factory.reg('RecordedModel', () => { return new RecordedModel(
            ipc,
            recordedDB,
            encodedDB,
            rulesDB,
            servicesDB,
            encodeManage,
            streamManage,
        ); });
        factory.reg('ChannelsModel', () => { return new ChannelsModel(servicesDB); });
        factory.reg('ReservesModel', () => { return new ReservesModel(ipc); });
        factory.reg('ScheduleModel', () => { return new ScheduleModel(
            programsDB,
            servicesDB,
            ipc,
        ); });
        factory.reg('ConfigModel', () => { return new ConfigModel(); });
        factory.reg('StorageModel', () => { return new StorageModel(); });
        factory.reg('EncodeModel', () => { return encodeModel; });
        factory.reg('StreamsModel', () => { return new StreamsModel(
            streamManage,
            (chanelId: apid.ServiceItemId, mode: number) => { return new MpegTsLiveStream(
                encodeProcessManage,
                streamManage,
                chanelId,
                mode,
            ); },
            (recordedId: apid.RecordedId, mode: number, encodedId: apid.EncodedId | null) => {
                return new RecordedHLSStream(
                    encodeProcessManage,
                    streamManage,
                    recordedDB,
                    encodedDB,
                    recordedId,
                    mode,
                    encodedId,
                );
            },
            programsDB,
            servicesDB,
            recordedDB,
        ); });
    }
}

export default ModelFactorySetting;
