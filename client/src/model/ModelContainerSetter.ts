import { Container } from 'inversify';
import ChannelsApiModel from './api/channels/ChannelsApiModel';
import IChannelsApiModel from './api/channels/IChannelsApiModel';
import ConfigApiModel from './api/config/ConfigApiModel';
import IConfigApiModel from './api/config/IConfigApiModel';
import EncodeApiModel from './api/encode/EncodeApiModel';
import IEncodeApiModel from './api/encode/IEncodeApiModel';
import IRepositoryModel from './api/IRepositoryModel';
import IRecordedApiModel from './api/recorded/IRecordedApiModel';
import RecordedApiModel from './api/recorded/RecordedApiModel';
import RepositoryModel from './api/RepositoryModel';
import IReservesApiModel from './api/reserves/IReservesApiModel';
import ReservesApiModel from './api/reserves/ReservesApiModel';
import IRuleApiModel from './api/rule/IRuleApiModel';
import RuleApiModel from './api/rule/RuleApiModel';
import IScheduleApiModel from './api/schedule/IScheduleApiModel';
import ScheduleApiModel from './api/schedule/ScheduleApiModel';
import IStreamApiModel from './api/streams/IStreamApiModel';
import StreamApiModel from './api/streams/StreamApiModel';
import IVideoApiModel from './api/video/IVideoApiModel';
import VideoApiModel from './api/video/VideoApiModel';
import ChannelModel from './channels/ChannelModel';
import IChannelModel from './channels/IChannelModel';
import IServerConfigModel from './serverConfig/IServerConfigModel';
import ServerConfigModel from './serverConfig/ServerConfigModel';
import ISocketIOModel from './socketio/ISocketIOModel';
import SocketIOModel from './socketio/SocketIOModel';
import AddEncodeState from './state/encode/AddEncodeState';
import IAddEncodeState from './state/encode/IAddEncodeState';
import GuideProgramDialogState from './state/guide/GuideProgramDialogState';
import GuideReserveUtil from './state/guide/GuideReserveUtil';
import GuideState from './state/guide/GuideState';
import IGuideProgramDialogState from './state/guide/IGuideProgramDialogState';
import IGuideReserveUtil from './state/guide/IGuideReserveUtil';
import IGuideState from './state/guide/IGuideState';
import IScrollPositionState from './state/IScrollPositionState';
import INavigationState from './state/navigation/INavigationState';
import NavigationState from './state/navigation/NavigationState';
import ILiveHLSVideoState from './state/onair/ILiveHLSVideoState';
import IOnAirSelectStreamState from './state/onair/IOnAirSelectStreamState';
import IOnAirState from './state/onair/IOnAirState';
import LiveHLSVideoState from './state/onair/LiveHLSVideoState';
import OnAirSelectStreamState from './state/onair/OnAirSelectStreamState';
import OnAirState from './state/onair/OnAirState';
import IWatchOnAirInfoState from './state/onair/watch/IWatchOnAirInfoState';
import WatchOnAirInfoState from './state/onair/watch/WatchOnAirInfoState';
import IRecordedDetailSelectStreamState from './state/recorded/detail/IRecordedDetailSelectStreamState';
import IRecordedDetailState from './state/recorded/detail/IRecordedDetailState';
import RecordedDetailSelectStreamState from './state/recorded/detail/RecordedDetailSelectStreamState';
import RecordedDetailState from './state/recorded/detail/RecordedDetailState';
import IRecordedState from './state/recorded/IRecordedState';
import IRecordedUtil from './state/recorded/IRecordedUtil';
import RecordedState from './state/recorded/RecordedState';
import RecordedUtil from './state/recorded/RecordedUtil';
import IRecordedHLSStreamingVideoState from './state/recorded/streaming/IRecordedHLSStreamingVideoState';
import IRecordedStreamingVideoState from './state/recorded/streaming/IRecordedStreamingVideoState';
import RecordedHLSStreamingVideoState from './state/recorded/streaming/RecordedHLSStreamingVideoState';
import RecordedStreamingVideoState from './state/recorded/streaming/RecordedStreamingVideoState';
import IWatchRecordedInfoState from './state/recorded/watch/IWatchRecordedInfoState';
import WatchRecordedInfoState from './state/recorded/watch/WatchRecordedInfoState';
import IReservesState from './state/reserve/IReservesState';
import IReserveStateUtil from './state/reserve/IReserveStateUtil';
import ReservesState from './state/reserve/ReservesState';
import ReserveStateUtil from './state/reserve/ReserveStateUtil';
import IRuleState from './state/rule/IRuleState';
import RuleState from './state/rule/RuleState';
import ScrollPositionState from './state/ScrollPositionState';
import ISearchState from './state/search/ISearchState';
import SearchState from './state/search/SearchState';
import ISnackbarState from './state/snackbar/ISnackbarState';
import SnackbarState from './state/snackbar/SnackbarState';
import AddEncodeSettingStorageModel from './storage/encode/AddEncodeSettingStorageModel';
import IAddEncodeSettingStorageModel from './storage/encode/IAddEncodeSettingStorageModel';
import GuideProgramDialogSettingStorageModel from './storage/guide/GuideProgramDialogSettingStorageModel';
import IGuideProgramDialogSettingStorageModel from './storage/guide/IGuideProgramDialogSettingStorageModel';
import IStorageOperationModel from './storage/IStorageOperationModel';
import IOnAirSelectStreamSettingStorageModel from './storage/onair/IOnAirSelectStreamSettingStorageModel';
import OnAirSelectStreamSettingStorageModel from './storage/onair/OnAirSelectStreamSettingStorageModel';
import ISettingStorageModel from './storage/setting/ISettingStorageModel';
import SettingStorageModel from './storage/setting/SettingStorageModel';
import StorageOperationModel from './storage/StorageOperationModel';

/**
 * container に各 Model を登録する
 */
export default (container: Container) => {
    container.bind<IRepositoryModel>('IRepositoryModel').to(RepositoryModel).inSingletonScope();

    container.bind<IConfigApiModel>('IConfigApiModel').to(ConfigApiModel).inSingletonScope();

    container.bind<IChannelsApiModel>('IChannelsApiModel').to(ChannelsApiModel).inSingletonScope();

    container.bind<IReservesApiModel>('IReservesApiModel').to(ReservesApiModel).inSingletonScope();

    container.bind<IScheduleApiModel>('IScheduleApiModel').to(ScheduleApiModel).inSingletonScope();

    container.bind<IStreamApiModel>('IStreamApiModel').to(StreamApiModel).inSingletonScope();

    container.bind<IRecordedApiModel>('IRecordedApiModel').to(RecordedApiModel).inSingletonScope();

    container.bind<IRuleApiModel>('IRuleApiModel').to(RuleApiModel).inSingletonScope();

    container.bind<IEncodeApiModel>('IEncodeApiModel').to(EncodeApiModel).inSingletonScope();

    container.bind<IVideoApiModel>('IVideoApiModel').to(VideoApiModel).inSingletonScope();

    container.bind<IStorageOperationModel>('IStorageOperationModel').to(StorageOperationModel).inSingletonScope();

    container.bind<ISettingStorageModel>('ISettingStorageModel').to(SettingStorageModel).inSingletonScope();

    container
        .bind<IGuideProgramDialogSettingStorageModel>('IGuideProgramDialogSettingStorageModel')
        .to(GuideProgramDialogSettingStorageModel)
        .inSingletonScope();

    container
        .bind<IAddEncodeSettingStorageModel>('IAddEncodeSettingStorageModel')
        .to(AddEncodeSettingStorageModel)
        .inSingletonScope();

    container
        .bind<IOnAirSelectStreamSettingStorageModel>('IOnAirSelectStreamSettingStorageModel')
        .to(OnAirSelectStreamSettingStorageModel)
        .inSingletonScope();

    container.bind<IServerConfigModel>('IServerConfigModel').to(ServerConfigModel).inSingletonScope();

    container.bind<IChannelModel>('IChannelModel').to(ChannelModel).inSingletonScope();

    container.bind<ISocketIOModel>('ISocketIOModel').to(SocketIOModel).inSingletonScope();

    container.bind<IScrollPositionState>('IScrollPositionState').to(ScrollPositionState).inSingletonScope();

    container.bind<INavigationState>('INavigationState').to(NavigationState).inSingletonScope();

    container.bind<ISnackbarState>('ISnackbarState').to(SnackbarState).inSingletonScope();

    container.bind<IOnAirState>('IOnAirState').to(OnAirState).inSingletonScope();

    container.bind<IOnAirSelectStreamState>('IOnAirSelectStreamState').to(OnAirSelectStreamState).inSingletonScope();

    container.bind<IWatchOnAirInfoState>('IWatchOnAirInfoState').to(WatchOnAirInfoState).inSingletonScope();

    container.bind<ILiveHLSVideoState>('ILiveHLSVideoState').to(LiveHLSVideoState);

    container.bind<IGuideReserveUtil>('IGuideReserveUtil').to(GuideReserveUtil).inSingletonScope();

    container.bind<IGuideState>('IGuideState').to(GuideState).inSingletonScope();

    container.bind<IGuideProgramDialogState>('IGuideProgramDialogState').to(GuideProgramDialogState).inSingletonScope();

    container.bind<IReserveStateUtil>('IReserveStateUtil').to(ReserveStateUtil).inSingletonScope();

    container.bind<IReservesState>('IReservesState').to(ReservesState).inSingletonScope();

    container.bind<IRecordedUtil>('IRecordedUtil').to(RecordedUtil).inSingletonScope();

    container.bind<IRecordedState>('IRecordedState').to(RecordedState).inSingletonScope();

    container.bind<IRecordedDetailState>('IRecordedDetailState').to(RecordedDetailState).inSingletonScope();

    container
        .bind<IRecordedDetailSelectStreamState>('IRecordedDetailSelectStreamState')
        .to(RecordedDetailSelectStreamState)
        .inSingletonScope();

    container
        .bind<IRecordedStreamingVideoState>('IRecordedStreamingVideoState')
        .to(RecordedStreamingVideoState)
        .inSingletonScope();

    container
        .bind<IRecordedHLSStreamingVideoState>('IRecordedHLSStreamingVideoState')
        .to(RecordedHLSStreamingVideoState)
        .inSingletonScope();

    container.bind<IWatchRecordedInfoState>('IWatchRecordedInfoState').to(WatchRecordedInfoState).inSingletonScope();

    container.bind<ISearchState>('ISearchState').to(SearchState).inSingletonScope();

    container.bind<IRuleState>('IRuleState').to(RuleState).inSingletonScope();

    container.bind<IAddEncodeState>('IAddEncodeState').to(AddEncodeState).inSingletonScope();
};
