import factory from './ModelFactory';
import { ServicesDB } from './DB/ServicesDB';
import { ProgramsDB } from './DB/ProgramsDB';
import { RulesDB } from './DB/RulesDB';
import { RecordedDB } from './DB/RecordedDB';
import { EncodedDB } from './DB/EncodedDB';
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

        factory.reg('RulesModel', () => { return new RulesModel(ipc, new RulesDB()) });
        factory.reg('RecordedModel', () => { return new RecordedModel(
            ipc,
            new RecordedDB(),
            new EncodedDB(),
            new RulesDB(),
            new ServicesDB(),
            encodeManager,
        ); });
        factory.reg('ChannelsModel', () => { return new ChannelsModel(new ServicesDB()); });
        factory.reg('ReservesModel', () => { return new ReservesModel(ipc); });
        factory.reg('ScheduleModel', () => { return new ScheduleModel(
            new ProgramsDB(),
            new ServicesDB(),
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
                    new RecordedDB(),
                    new EncodedDB(),
                    recordedId,
                    mode,
                    encodedId,
                );
            },
            new ProgramsDB(),
            new ServicesDB(),
            new RecordedDB(),
        ); });
    }
}

export default ModelFactorySetting;
