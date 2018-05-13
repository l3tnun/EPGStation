import * as apid from '../../../api';
import { ChannelsModel } from './Api/ChannelsModel';
import { ConfigModel } from './Api/ConfigModel';
import { IPTVModel } from './Api/IPTVModel';
import { RecordedModel } from './Api/RecordedModel';
import { ReservesModel } from './Api/ReservesModel';
import { RulesModel } from './Api/RulesModel';
import { ScheduleModel } from './Api/ScheduleModel';
import { StorageModel } from './Api/StorageModel';
import { StreamsModel } from './Api/StreamsModel';

import Util from '../Util/Util';

import DBOperator from './DB/DBOperator';
import { EncodedDBInterface } from './DB/EncodedDB';
import { ProgramsDBInterface } from './DB/ProgramsDB';
import { RecordedDBInterface } from './DB/RecordedDB';
import { RulesDBInterface } from './DB/RulesDB';
import { ServicesDBInterface } from './DB/ServicesDB';

import MySQLEncodedDB from './DB/MySQL/MySQLEncodedDB';
import MySQLOperator from './DB/MySQL/MySQLOperator';
import MySQLProgramsDB from './DB/MySQL/MySQLProgramsDB';
import MySQLRecordedDB from './DB/MySQL/MySQLRecordedDB';
import MySQLRulesDB from './DB/MySQL/MySQLRulesDB';
import MySQLServicesDB from './DB/MySQL/MySQLServicesDB';

import PostgreSQLEncodedDB from './DB/PostgreSQL/PostgreSQLEncodedDB';
import PostgreSQLOperator from './DB/PostgreSQL/PostgreSQLOperator';
import PostgreSQLProgramsDB from './DB/PostgreSQL/PostgreSQLProgramsDB';
import PostgreSQLRecordedDB from './DB/PostgreSQL/PostgreSQLRecordedDB';
import PostgreSQLRulesDB from './DB/PostgreSQL/PostgreSQLRulesDB';
import PostgreSQLServicesDB from './DB/PostgreSQL/PostgreSQLServicesDB';

import SQLite3EncodedDB from './DB/SQLite3/SQLite3EncodedDB';
import SQLite3Operator from './DB/SQLite3/SQLite3Operator';
import SQLite3ProgramsDB from './DB/SQLite3/SQLite3ProgramsDB';
import SQLite3RecordedDB from './DB/SQLite3/SQLite3RecordedDB';
import SQLite3RulesDB from './DB/SQLite3/SQLite3RulesDB';
import SQLite3ServicesDB from './DB/SQLite3/SQLite3ServicesDB';

import { IPCClient } from './IPC/IPCClient';
import factory from './ModelFactory';

import { EncodeFinModel } from './Service/Encode/EncodeFinModel';
import { EncodeManageModel } from './Service/Encode/EncodeManageModel';
import { EncodeProcessManageModel } from './Service/Encode/EncodeProcessManageModel';
import { SocketIoManageModel } from './Service/SocketIoManageModel';
import HLSLiveStream from './Service/Stream/HLSLiveStream';
import MpegTsLiveStream from './Service/Stream/MpegTsLiveStream';
import RecordedHLSStream from './Service/Stream/RecordedHLSStream';
import RecordedStreamingMpegTsStream from './Service/Stream/RecordedStreamingMpegTsStream';
import { ContainerType, RecordedStreamingMultiTypeStream } from './Service/Stream/RecordedStreamingMultiTypeStream';
import { StreamManageModel } from './Service/Stream/StreamManageModel';
import WebMLiveStream from './Service/Stream/WebMLiveStream';

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
                recordedDB = new MySQLRecordedDB(operator);
                encodedDB = new MySQLEncodedDB(operator);
                break;

            case 'sqlite3':
                operator = new SQLite3Operator();
                servicesDB = new SQLite3ServicesDB(operator);
                programsDB = new SQLite3ProgramsDB(operator);
                rulesDB = new SQLite3RulesDB(operator);
                recordedDB = new SQLite3RecordedDB(operator);
                encodedDB = new SQLite3EncodedDB(operator);
                break;

            case 'postgresql':
                operator = new PostgreSQLOperator();
                servicesDB = new PostgreSQLServicesDB(operator);
                programsDB = new PostgreSQLProgramsDB(operator);
                rulesDB = new PostgreSQLRulesDB(operator);
                recordedDB = new PostgreSQLRecordedDB(operator);
                encodedDB = new PostgreSQLEncodedDB(operator);
                break;
        }

        const encodeProcessManage = new EncodeProcessManageModel();
        const encodeManage = new EncodeManageModel(encodeProcessManage);
        const socketIoManage = new SocketIoManageModel();
        const ipc = new IPCClient();
        const encodeFinModel = new EncodeFinModel(
            encodeManage,
            encodedDB!,
            socketIoManage,
            ipc,
        );
        const streamManage = new StreamManageModel(socketIoManage);

        ipc.setModels(encodeManage, socketIoManage);

        factory.reg('SocketIoManageModel', () => { return socketIoManage; });
        factory.reg('RulesModel', () => { return new RulesModel(ipc, rulesDB); });
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
        factory.reg('IPTVModel', () => { return new IPTVModel(
            programsDB,
            servicesDB,
        ); });
        factory.reg('StorageModel', () => { return new StorageModel(); });
        factory.reg('EncodeFinModel', () => { return encodeFinModel; });
        factory.reg('StreamsModel', () => { return new StreamsModel(
            streamManage,
            (chanelId: apid.ServiceItemId, mode: number): HLSLiveStream => { return new HLSLiveStream(
                encodeProcessManage,
                streamManage,
                chanelId,
                mode,
            ); },
            (chanelId: apid.ServiceItemId, mode: number): WebMLiveStream => { return new WebMLiveStream(
                encodeProcessManage,
                streamManage,
                chanelId,
                mode,
            ); },
            (chanelId: apid.ServiceItemId, mode: number): MpegTsLiveStream => { return new MpegTsLiveStream(
                encodeProcessManage,
                streamManage,
                chanelId,
                mode,
            ); },
            (recordedId: apid.RecordedId, mode: number, encodedId: apid.EncodedId | null): RecordedHLSStream => {
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
            (recordedId: apid.RecordedId, mode: number, startTime: number, headerRangeStr: string | null): RecordedStreamingMpegTsStream => {
                return new RecordedStreamingMpegTsStream(
                    encodeProcessManage,
                    streamManage,
                    recordedDB,
                    recordedId,
                    mode,
                    startTime,
                    headerRangeStr,
                );
            },
            (recordedId: apid.RecordedId, mode: number, startTime: number, containerType: ContainerType): RecordedStreamingMultiTypeStream => {
                return new RecordedStreamingMultiTypeStream(
                    encodeProcessManage,
                    streamManage,
                    recordedDB,
                    recordedId,
                    mode,
                    startTime,
                    containerType,
                );
            },
            programsDB,
            servicesDB,
            recordedDB,
        ); });
    };
}

export default ModelFactorySetting;
