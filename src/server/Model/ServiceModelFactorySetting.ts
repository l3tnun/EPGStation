import factory from './ModelFactory';
import MySQLServicesDB from './DB/MySQL/ServicesDB';
import MySQLProgramsDB from './DB/MySQL/ProgramsDB';
import MySQLRulesDB from './DB/MySQL/RulesDB';
import MySQLRecordedDB from './DB/MySQL/RecordedDB';
import MySQLEncodedDB from './DB/MySQL/EncodedDB';
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
import * as apid from '../../../api';

/**
* Service 用の Model 設定
*/
namespace ModelFactorySetting {
    /**
    * Model をセットする
    */
    export const init = (): void => {
        const servicesDB = new MySQLServicesDB();
        const programsDB = new MySQLProgramsDB();
        const rulesDB = new MySQLRulesDB();
        const recordedDB = new MySQLRecordedDB();
        const encodedDB = new MySQLEncodedDB();

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
