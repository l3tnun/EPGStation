import { Container } from 'inversify';

import ApiUtil from './api/ApiUtil';
import ChannelApiModel from './api/channel/ChannelApiModel';
import IChannelApiModel from './api/channel/IChannelApiModel';
import ConfigApiModel from './api/config/ConfigApiModel';
import IConfigApiModel from './api/config/IConfigApiModel';
import DropLogApiModel from './api/dropLog/DropLogApiModel';
import IDropLogApiModel from './api/dropLog/IDropLogApiModel';
import EncodeApiModel from './api/encode/EncodeApiModel';
import IEncodeApiModel from './api/encode/IEncodeApiModel';
import IApiUtil from './api/IApiUtil';
import IIPTVApiModel from './api/iptv/IIPTVApiModel';
import IPTVApiModel from './api/iptv/IPTVApiModel';
import IRecordedItemUtil from './api/IRecordedItemUtil';
import IRecordedApiModel from './api/recorded/IRecordedApiModel';
import RecordedApiModel from './api/recorded/RecordedApiModel';
import RecordedItemUtil from './api/RecordedItemUtil';
import IRecordedTagApiModel from './api/recordedTag/IRecordedTagApiModel';
import RecordedTagApiModel from './api/recordedTag/RecordedTagApiModel';
import IRecordingApiModel from './api/recording/IRecordingApiModel';
import RecordingApiModel from './api/recording/RecordingApiModel';
import IReserveApiModel from './api/reserve/IReserveApiModel';
import ReserveApiModel from './api/reserve/ReserveApiModel';
import IRuleApiModel from './api/rule/IRuleApiModel';
import RuleApiModel from './api/rule/RuleApiModel';
import IScheduleApiModel from './api/schedule/IScheduleApiModel';
import ScheduleApiModel from './api/schedule/ScheduleApiModel';
import IStorageApiModel from './api/storage/IStorageApiModel';
import StorageApiModel from './api/storage/StorageApiModel';
import IStreamApiModel from './api/stream/IStreamApiModel';
import StreamApiModel from './api/stream/StreamApiModel';
import IThumbnailApiModel from './api/thumbnail/IThumbnailApiModel';
import ThumbnailApiModel from './api/thumbnail/ThumbnailApiModel';
import IVideoApiModel from './api/video/IVideoApiModel';
import IVideoUtil from './api/video/IVideoUtil';
import VideoApiModel from './api/video/VideoApiModel';
import VideoUtil from './api/video/VideoUtil';
import Configuration from './Configuration';
import ConnectionCheckModel from './ConnectionCheckModel';
import ChannelDB from './db/ChannelDB';
import DBOperator from './db/DBOperator';
import DropLogFileDB from './db/DropLogFileDB';
import IChannelDB from './db/IChannelDB';
import IDBOperator from './db/IDBOperator';
import IDropLogFileDB from './db/IDropLogFileDB';
import IProgramDB from './db/IProgramDB';
import IRecordedDB from './db/IRecordedDB';
import IRecordedHistoryDB from './db/IRecordedHistoryDB';
import IRecordedTagDB from './db/IRecordedTagDB';
import IReserveDB from './db/IReserveDB';
import IRuleDB from './db/IRuleDB';
import IThumbnailDB from './db/IThumbnailDB';
import IVideoFileDB from './db/IVideoFileDB';
import ProgramDB from './db/ProgramDB';
import RecordedDB from './db/RecordedDB';
import RecordedHistoryDB from './db/RecordedHistoryDB';
import RecordedTagDB from './db/RecordedTagDB';
import ReserveDB from './db/ReserveDB';
import RuleDB from './db/RuleDB';
import ThumbnailDB from './db/ThumbnailDB';
import VideoFileDB from './db/VideoFileDB';
import EPGUpdateExecutorManageModel from './epgUpdater/EPGUpdateExecutorManageModel';
import EPGUpdateManageModel from './epgUpdater/EPGUpdateManageModel';
import EPGUpdater from './epgUpdater/EPGUpdater';
import IEPGUpdateExecutorManageModel from './epgUpdater/IEPGUpdateExecutorManageModel';
import IEPGUpdateManageModel from './epgUpdater/IEPGUpdateManageModel';
import IEPGUpdater from './epgUpdater/IEPGUpdater';
import EncodeEvent from './event/EncodeEvent';
import EPGUpdateEvent from './event/EPGUpdateEvent';
import EventSetter from './event/EventSetter';
import IEncodeEvent from './event/IEncodeEvent';
import IEPGUpdateEvent from './event/IEPGUpdateEvent';
import IEventSetter from './event/IEventSetter';
import IRecordedEvent from './event/IRecordedEvent';
import IRecordedTagEvent from './event/IRecordedTagEvent';
import IRecordingEvent from './event/IRecordingEvent';
import IReserveEvent from './event/IReserveEvent';
import IRuleEvent from './event/IRuleEvent';
import IThumbnailEvent from './event/IThumbnailEvent';
import RecordedEvent from './event/RecordedEvent';
import RecordedTagEvent from './event/RecordedTagEvent';
import RecordingEvent from './event/RecordingEvent';
import ReserveEvent from './event/ReserveEvent';
import RuleEvent from './event/RuleEvent';
import ThumbnailEvent from './event/ThumbnailEvent';
import ExecutionManagementModel from './ExecutionManagementModel';
import IConfiguration from './IConfiguration';
import IConnectionCheckModel from './IConnectionCheckModel';
import IExecutionManagementModel from './IExecutionManagementModel';
import ILoggerModel from './ILoggerModel';
import IMirakurunClientModel from './IMirakurunClientModel';
import IIPCClient from './ipc/IIPCClient';
import IIPCServer from './ipc/IIPCServer';
import IPCClient from './ipc/IPCClient';
import IPCServer from './ipc/IPCServer';
import { IPromiseQueue } from './IPromiseQueue';
import IPromiseRetry from './IPromiseRetry';
import LoggerModel from './LoggerModel';
import MirakurunClientModel from './MirakurunClientModel';
import ExternalCommandManageModel from './operator/externalCommand/ExternalCommandManageModel';
import IExternalCommandManageModel from './operator/externalCommand/IExternalCommandManageModel';
import IReserveOptionChecker from './operator/IReserveOptionChecker';
import IRecordedManageModel from './operator/recorded/IRecordedManageModel';
import RecordedManageModel from './operator/recorded/RecordedManageModel';
import IRecordedTagManadeModel from './operator/recordedTag/IRecordedTagManadeModel';
import RecordedTagManadeModel from './operator/recordedTag/RecordedTagManadeModel';
import DropCheckerModel from './operator/recording/DropCheckerModel';
import IDropCheckerModel from './operator/recording/IDropCheckerModel';
import IRecorderModel, { RecorderModelProvider } from './operator/recording/IRecorderModel';
import IRecordingManageModel from './operator/recording/IRecordingManageModel';
import IRecordingStreamCreator from './operator/recording/IRecordingStreamCreator';
import IRecordingUtilModel from './operator/recording/IRecordingUtilModel';
import RecorderModel from './operator/recording/RecorderModel';
import RecordingManageModel from './operator/recording/RecordingManageModel';
import RecordingStreamCreator from './operator/recording/RecordingStreamCreator';
import RecordingUtilModel from './operator/recording/RecordingUtilModel';
import IReservationManageModel from './operator/reservation/IReservationManageModel';
import ReservationManageModel from './operator/reservation/ReservationManageModel';
import ReserveOptionChecker from './operator/ReserveOptionChecker';
import IRuleManageModel from './operator/rule/IRuleManageModel';
import RuleManageModel from './operator/rule/RuleManageModel';
import IStorageManageModel from './operator/storage/IStorageManageModel';
import StorageManageModel from './operator/storage/StorageManageModel';
import IThumbnailManageModel from './operator/thumbnail/IThumbnailManageModel';
import ThumbnailManageModel from './operator/thumbnail/ThumbnailManageModel';
import PromiseQueue from './PromiseQueue';
import PromiseRetry from './PromiseRetry';
import EncodeFinishModel from './service/encode/EncodeFinishModel';
import EncodeManageModel from './service/encode/EncodeManageModel';
import EncodeProcessManageModel from './service/encode/EncodeProcessManageModel';
import IEncodeFinishModel from './service/encode/IEncodeFinishModel';
import IEncodeManageModel from './service/encode/IEncodeManageModel';
import IEncodeProcessManageModel from './service/encode/IEncodeProcessManageModel';
import IServiceServer from './service/IServiceServer';
import ServiceServer from './service/ServiceServer';
import ISocketIOManageModel from './service/socketio/ISocketIOManageModel';
import SocketIOManageModel from './service/socketio/SocketIOManageModel';
import ILiveStreamBaseModel, {
    LiveHLSStreamModelProvider,
    LiveStreamModelProvider,
} from './service/stream/base/ILiveStreamBaseModel';
import IRecordedStreamBaseModel, {
    RecordedHLSStreamModelProvider,
    RecordedStreamModelProvider,
} from './service/stream/base/IRecordedStreamBaseModel';
import LiveHLSStreamModel from './service/stream/LiveHLSStreamModel';
import LiveStreamModel from './service/stream/LiveStreamModel';
import IStreamManageModel from './service/stream/manager/IStreamManageModel';
import StreamManageModel from './service/stream/manager/StreamManageModel';
import RecordedHLSStreamModel from './service/stream/RecordedHLSStreamModel';
import RecordedStreamModel from './service/stream/RecordedStreamModel';
import HLSFileDeleterModel from './service/stream/util/HLSFileDeleterModel';
import IHLSFileDeleterModel from './service/stream/util/IHLSFileDeleterModel';

/**
 * container に 各 Model を登録する
 */
export const set = (container: Container): void => {
    container.bind<ILoggerModel>('ILoggerModel').to(LoggerModel).inSingletonScope();

    container.bind<IConfiguration>('IConfiguration').to(Configuration).inSingletonScope();

    container.bind<IConnectionCheckModel>('IConnectionCheckModel').to(ConnectionCheckModel).inSingletonScope();

    container.bind<IPromiseQueue>('IPromiseQueue').to(PromiseQueue);

    container.bind<IPromiseRetry>('IPromiseRetry').to(PromiseRetry);

    container.bind<IExecutionManagementModel>('IExecutionManagementModel').to(ExecutionManagementModel);

    container.bind<IIPCClient>('IIPCClient').to(IPCClient).inSingletonScope();

    container.bind<IIPCServer>('IIPCServer').to(IPCServer).inSingletonScope();

    container.bind<IDBOperator>('IDBOperator').to(DBOperator).inSingletonScope();

    container.bind<IChannelDB>('IChannelDB').to(ChannelDB).inSingletonScope();

    container.bind<IProgramDB>('IProgramDB').to(ProgramDB).inSingletonScope();

    container.bind<IRecordedDB>('IRecordedDB').to(RecordedDB).inSingletonScope();

    container.bind<IRecordedTagDB>('IRecordedTagDB').to(RecordedTagDB).inSingletonScope();

    container.bind<IRecordedHistoryDB>('IRecordedHistoryDB').to(RecordedHistoryDB).inSingletonScope();

    container.bind<IReserveDB>('IReserveDB').to(ReserveDB).inSingletonScope();

    container.bind<IRuleDB>('IRuleDB').to(RuleDB).inRequestScope();

    container.bind<IThumbnailDB>('IThumbnailDB').to(ThumbnailDB).inSingletonScope();

    container.bind<IVideoFileDB>('IVideoFileDB').to(VideoFileDB).inSingletonScope();

    container.bind<IDropLogFileDB>('IDropLogFileDB').to(DropLogFileDB).inSingletonScope();

    container.bind<IRuleEvent>('IRuleEvent').to(RuleEvent).inSingletonScope();

    container.bind<IThumbnailEvent>('IThumbnailEvent').to(ThumbnailEvent).inSingletonScope();

    container.bind<IRecordedEvent>('IRecordedEvent').to(RecordedEvent).inSingletonScope();

    container.bind<IRecordingEvent>('IRecordingEvent').to(RecordingEvent).inSingletonScope();

    container.bind<IRecordedTagEvent>('IRecordedTagEvent').to(RecordedTagEvent).inSingletonScope();

    container.bind<IReserveEvent>('IReserveEvent').to(ReserveEvent).inSingletonScope();

    container.bind<IEPGUpdateEvent>('IEPGUpdateEvent').to(EPGUpdateEvent).inSingletonScope();

    container
        .bind<IEPGUpdateExecutorManageModel>('IEPGUpdateExecutorManageModel')
        .to(EPGUpdateExecutorManageModel)
        .inSingletonScope();

    container.bind<IReserveOptionChecker>('IReserveOptionChecker').to(ReserveOptionChecker).inSingletonScope();

    container.bind<IMirakurunClientModel>('IMirakurunClientModel').to(MirakurunClientModel).inSingletonScope();

    container.bind<IEPGUpdateManageModel>('IEPGUpdateManageModel').to(EPGUpdateManageModel).inSingletonScope();

    container.bind<IEPGUpdater>('IEPGUpdater').to(EPGUpdater).inSingletonScope();

    container.bind<IReservationManageModel>('IReservationManageModel').to(ReservationManageModel).inSingletonScope();

    container.bind<IRuleManageModel>('IRuleManageModel').to(RuleManageModel).inSingletonScope();

    container.bind<IRecordingStreamCreator>('IRecordingStreamCreator').to(RecordingStreamCreator).inSingletonScope();

    container.bind<IRecordingUtilModel>('IRecordingUtilModel').to(RecordingUtilModel).inSingletonScope();

    container.bind<IDropCheckerModel>('IDropCheckerModel').to(DropCheckerModel);

    container.bind<IRecorderModel>('IRecorderModel').to(RecorderModel);

    container.bind<RecorderModelProvider>('RecorderModelProvider').toProvider(context => {
        return () => {
            return new Promise<IRecorderModel>(
                (resolve: (model: IRecorderModel) => void, reject: (err: Error) => void) => {
                    try {
                        const recorderModel = context.container.get<IRecorderModel>('IRecorderModel');
                        resolve(recorderModel);
                    } catch (err) {
                        reject(err);
                    }
                },
            );
        };
    });

    container.bind<IRecordedManageModel>('IRecordedManageModel').to(RecordedManageModel).inSingletonScope();

    container.bind<IRecordingManageModel>('IRecordingManageModel').to(RecordingManageModel).inSingletonScope();

    container.bind<IRecordedTagManadeModel>('IRecordedTagManadeModel').to(RecordedTagManadeModel).inSingletonScope();

    container.bind<IThumbnailManageModel>('IThumbnailManageModel').to(ThumbnailManageModel).inSingletonScope();

    container.bind<IStorageManageModel>('IStorageManageModel').to(StorageManageModel).inSingletonScope();

    container.bind<IEventSetter>('IEventSetter').to(EventSetter).inSingletonScope();

    container.bind<ISocketIOManageModel>('ISocketIOManageModel').to(SocketIOManageModel).inSingletonScope();

    container
        .bind<IExternalCommandManageModel>('IExternalCommandManageModel')
        .to(ExternalCommandManageModel)
        .inSingletonScope();

    container.bind<IServiceServer>('IServiceServer').to(ServiceServer).inSingletonScope();

    container.bind<IApiUtil>('IApiUtil').to(ApiUtil).inSingletonScope();

    container.bind<IRecordedItemUtil>('IRecordedItemUtil').to(RecordedItemUtil).inSingletonScope();

    container.bind<IConfigApiModel>('IConfigApiModel').to(ConfigApiModel).inSingletonScope();

    container.bind<IChannelApiModel>('IChannelApiModel').to(ChannelApiModel).inSingletonScope();

    container.bind<IScheduleApiModel>('IScheduleApiModel').to(ScheduleApiModel).inSingletonScope();

    container.bind<IReserveApiModel>('IReserveApiModel').to(ReserveApiModel).inSingletonScope();

    container.bind<IRecordedApiModel>('IRecordedApiModel').to(RecordedApiModel).inSingletonScope();

    container.bind<IRecordingApiModel>('IRecordingApiModel').to(RecordingApiModel).inSingletonScope();

    container.bind<IRecordedTagApiModel>('IRecordedTagApiModel').to(RecordedTagApiModel).inSingletonScope();

    container.bind<IRuleApiModel>('IRuleApiModel').to(RuleApiModel).inSingletonScope();

    container.bind<IThumbnailApiModel>('IThumbnailApiModel').to(ThumbnailApiModel).inSingletonScope();

    container.bind<IDropLogApiModel>('IDropLogApiModel').to(DropLogApiModel).inSingletonScope();

    container.bind<IVideoUtil>('IVideoUtil').to(VideoUtil).inSingletonScope();

    container.bind<IVideoApiModel>('IVideoApiModel').to(VideoApiModel).inSingletonScope();

    container.bind<IEncodeApiModel>('IEncodeApiModel').to(EncodeApiModel).inSingletonScope();

    container.bind<IIPTVApiModel>('IIPTVApiModel').to(IPTVApiModel).inSingletonScope();

    container.bind<IEncodeEvent>('IEncodeEvent').to(EncodeEvent).inSingletonScope();

    container
        .bind<IEncodeProcessManageModel>('IEncodeProcessManageModel')
        .to(EncodeProcessManageModel)
        .inSingletonScope();

    container.bind<IEncodeManageModel>('IEncodeManageModel').to(EncodeManageModel).inSingletonScope();

    container.bind<IEncodeFinishModel>('IEncodeFinishModel').to(EncodeFinishModel).inSingletonScope();

    container.bind<ILiveStreamBaseModel>('LiveStreamModel').to(LiveStreamModel);

    container.bind<LiveStreamModelProvider>('LiveStreamModelProvider').toProvider(context => {
        return () => {
            return new Promise<ILiveStreamBaseModel>((resolve, reject) => {
                try {
                    const streamModel = context.container.get<ILiveStreamBaseModel>('LiveStreamModel');
                    resolve(streamModel);
                } catch (err) {
                    reject(err);
                }
            });
        };
    });

    container.bind<IHLSFileDeleterModel>('IHLSFileDeleterModel').to(HLSFileDeleterModel);

    container.bind<ILiveStreamBaseModel>('LiveHLSStreamModel').to(LiveHLSStreamModel);

    container.bind<LiveHLSStreamModelProvider>('LiveHLSStreamModelProvider').toProvider(context => {
        return () => {
            return new Promise<ILiveStreamBaseModel>((resolve, reject) => {
                try {
                    const streamModel = context.container.get<ILiveStreamBaseModel>('LiveHLSStreamModel');
                    resolve(streamModel);
                } catch (err) {
                    reject(err);
                }
            });
        };
    });

    container.bind<IRecordedStreamBaseModel>('RecordedStreamModel').to(RecordedStreamModel);

    container.bind<RecordedStreamModelProvider>('RecordedStreamModelProvider').toProvider(context => {
        return () => {
            return new Promise<IRecordedStreamBaseModel>((resolve, reject) => {
                try {
                    const streamModel = context.container.get<IRecordedStreamBaseModel>('RecordedStreamModel');
                    resolve(streamModel);
                } catch (err) {
                    reject(err);
                }
            });
        };
    });

    container.bind<IRecordedStreamBaseModel>('RecordedHLSStreamModel').to(RecordedHLSStreamModel);
    container.bind<RecordedHLSStreamModelProvider>('RecordedHLSStreamModelProvider').toProvider(context => {
        return () => {
            return new Promise<IRecordedStreamBaseModel>((resolve, reject) => {
                try {
                    const streamModel = context.container.get<IRecordedStreamBaseModel>('RecordedHLSStreamModel');
                    resolve(streamModel);
                } catch (err) {
                    reject(err);
                }
            });
        };
    });

    container.bind<IStreamManageModel>('IStreamManageModel').to(StreamManageModel).inSingletonScope();

    container.bind<IStreamApiModel>('IStreamApiModel').to(StreamApiModel).inSingletonScope();

    container.bind<IStorageApiModel>('IStorageApiModel').to(StorageApiModel).inSingletonScope();
};
