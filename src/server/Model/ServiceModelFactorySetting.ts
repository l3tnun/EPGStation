import factory from './ModelFactory';
import MySQLOperator from './DB/MySQL/MySQLOperator';
import SQLite3Operator from './DB/SQLite3/SQLite3Operator';
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
import { RulesModel } from './Api/RulesModel';
import { RecordedModel } from './Api/RecordedModel';
import { ChannelsModel } from './Api/ChannelsModel';
import { ReservesModel } from './Api/ReservesModel';
import { IPCClient } from './IPC/IPCClient';
import { ScheduleModel } from './Api/ScheduleModel';
import { ConfigModel } from './Api/ConfigModel';
import { StorageModel } from './Api/StorageModel';
import { EncodeProcessManager } from '../Service/EncodeProcessManager';
import { EncodeManager } from '../Service/EncodeManager';
import { EncodeModel } from './Encode/EncodeModel';
import { StreamsModel } from './Api/StreamsModel';
import SocketIoServer from '../Service/SocketIoServer';
import { StreamManager } from '../Service/Stream/StreamManager';
import { MpegTsLiveStream } from '../Service/Stream/MpegTsLiveStream';
import { RecordedHLSStream } from '../Service/Stream/RecordedHLSStream';
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
        const isMysql = Util.getDBType() === 'mysql';
        const operator = isMysql ? new MySQLOperator() : new SQLite3Operator();
        const servicesDB = isMysql ? new MySQLServicesDB(operator) : new SQLite3ServicesDB(operator);
        const programsDB = isMysql ? new MySQLProgramsDB(operator) : new SQLite3ProgramsDB(operator);
        const rulesDB = isMysql ? new MySQLRulesDB(operator) : new SQLite3RulesDB(operator);
        const recordedDB = isMysql ? new MySQLRecordedDB(operator) : new SQLite3RecordedDB(operator);
        const encodedDB = isMysql ? new MySQLEncodedDB(operator) : new SQLite3EncodedDB(operator);

        let encodeProcessManager = EncodeProcessManager.getInstance();
        EncodeManager.init(encodeProcessManager);
        let encodeManager = EncodeManager.getInstance();

        let encodeModel = new EncodeModel(
            encodeManager,
            SocketIoServer.getInstance(),
        );
        IPCClient.init(encodeModel);
        let ipc = IPCClient.getInstance();
        encodeModel.setIPC(ipc);

        factory.reg('RulesModel', () => { return new RulesModel(ipc, rulesDB) });
        factory.reg('RecordedModel', () => { return new RecordedModel(
            ipc,
            recordedDB,
            encodedDB,
            rulesDB,
            servicesDB,
            encodeManager,
            StreamManager.getInstance(),
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
            StreamManager.getInstance(),
            (chanelId: apid.ServiceItemId, mode: number) => { return new MpegTsLiveStream(chanelId, mode); },
            (recordedId: apid.RecordedId, mode: number, encodedId: apid.EncodedId | null) => {
                return new RecordedHLSStream(
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
