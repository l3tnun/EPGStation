import { Container } from 'inversify';
import ChannelsApiModel from './api/channels/ChannelsApiModel';
import IChannelsApiModel from './api/channels/IChannelsApiModel';
import ConfigApiModel from './api/config/ConfigApiModel';
import IConfigApiModel from './api/config/IConfigApiModel';
import DropLogApiModel from './api/dropLog/DropLogApiModel';
import IDropLogApiModel from './api/dropLog/IDropLogApiModel';
import EncodeApiModel from './api/encode/EncodeApiModel';
import IEncodeApiModel from './api/encode/IEncodeApiModel';
import IRepositoryModel from './api/IRepositoryModel';
import IRecordedApiModel from './api/recorded/IRecordedApiModel';
import RecordedApiModel from './api/recorded/RecordedApiModel';
import IRecordingApiModel from './api/recording/IRecordingApiModel';
import RecordingApiModel from './api/recording/RecordingApiModel';
import RepositoryModel from './api/RepositoryModel';
import IReservesApiModel from './api/reserves/IReservesApiModel';
import ReservesApiModel from './api/reserves/ReservesApiModel';
import IRuleApiModel from './api/rule/IRuleApiModel';
import RuleApiModel from './api/rule/RuleApiModel';
import IScheduleApiModel from './api/schedule/IScheduleApiModel';
import ScheduleApiModel from './api/schedule/ScheduleApiModel';
import IStorageApiModel from './api/storage/IStorageApiModel';
import StorageApiModel from './api/storage/StorageApiModel';
import IStreamApiModel from './api/streams/IStreamApiModel';
import StreamApiModel from './api/streams/StreamApiModel';
import IThumbnailApiModel from './api/thumbnail/IThumbnailApiModel';
import ThumbnailApiModel from './api/thumbnail/ThumbnailApiModel';
import IVideoApiModel from './api/video/IVideoApiModel';
import VideoApiModel from './api/video/VideoApiModel';
import ChannelModel from './channels/ChannelModel';
import IChannelModel from './channels/IChannelModel';
import IPWAConfigModel from './pwa/IPWAConfigModel';
import PWAConfigModel from './pwa/PWAConfigModel';
import IServerConfigModel from './serverConfig/IServerConfigModel';
import ServerConfigModel from './serverConfig/ServerConfigModel';
import ISocketIOModel from './socketio/ISocketIOModel';
import SocketIOModel from './socketio/SocketIOModel';
import DashboardState from './state/dashboard/DashboardState';
import IDashboardState from './state/dashboard/IDashboardState';
import DropLogDialogState from './state/dropLog/DropLogDialogState';
import IDropLogDialogState from './state/dropLog/IDropLogDialogState';
import AddEncodeState from './state/encode/AddEncodeState';
import EncodeState from './state/encode/EncodeState';
import IAddEncodeState from './state/encode/IAddEncodeState';
import IEncodeState from './state/encode/IEncodeState';
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
import ISendVideoFileToKodiState from './state/recorded/detail/ISendVideoFileToKodiState';
import RecordedDetailSelectStreamState from './state/recorded/detail/RecordedDetailSelectStreamState';
import RecordedDetailState from './state/recorded/detail/RecordedDetailState';
import SendVideoFileToKodiState from './state/recorded/detail/SendVideoFileToKodiState';
import IRecordedState from './state/recorded/IRecordedState';
import IRecordedUtil from './state/recorded/IRecordedUtil';
import RecordedState from './state/recorded/RecordedState';
import RecordedUtil from './state/recorded/RecordedUtil';
import IRecordedSearchState from './state/recorded/search/IRecordedSearchState';
import RecordedSearchState from './state/recorded/search/RecordedSearchState';
import IRecordedHLSStreamingVideoState from './state/recorded/streaming/IRecordedHLSStreamingVideoState';
import IRecordedStreamingVideoState from './state/recorded/streaming/IRecordedStreamingVideoState';
import RecordedHLSStreamingVideoState from './state/recorded/streaming/RecordedHLSStreamingVideoState';
import RecordedStreamingVideoState from './state/recorded/streaming/RecordedStreamingVideoState';
import IRecordedUploadState from './state/recorded/upload/IRecordedUploadState';
import RecordedUploadState from './state/recorded/upload/RecordedUploadState';
import IWatchRecordedInfoState from './state/recorded/watch/IWatchRecordedInfoState';
import WatchRecordedInfoState from './state/recorded/watch/WatchRecordedInfoState';
import IRecordingState from './state/recording/IRecordingState';
import RecordingState from './state/recording/RecordingState';
import IReservesState from './state/reserve/IReservesState';
import IReserveStateUtil from './state/reserve/IReserveStateUtil';
import IManualReserveState from './state/reserve/manual/IManualReserveState';
import ManualReserveState from './state/reserve/manual/ManualReserveState';
import ReservesState from './state/reserve/ReservesState';
import ReserveStateUtil from './state/reserve/ReserveStateUtil';
import IRuleState from './state/rule/IRuleState';
import RuleState from './state/rule/RuleState';
import ScrollPositionState from './state/ScrollPositionState';
import ISearchState from './state/search/ISearchState';
import SearchState from './state/search/SearchState';
import ISnackbarState from './state/snackbar/ISnackbarState';
import SnackbarState from './state/snackbar/SnackbarState';
import IStorageState from './state/storage/IStorageState';
import StorageState from './state/storage/StorageState';
import AddEncodeSettingStorageModel from './storage/encode/AddEncodeSettingStorageModel';
import { IAddEncodeSettingStorageModel } from './storage/encode/IAddEncodeSettingStorageModel';
import GuideGenreSettingStorageModel from './storage/guide/GuideGenreSettingStorageModel';
import GuideProgramDialogSettingStorageModel from './storage/guide/GuideProgramDialogSettingStorageModel';
import GuideSizeSettingStorageModel from './storage/guide/GuideSizeSettingStorageModel';
import { IGuideGenreSettingStorageModel } from './storage/guide/IGuideGenreSettingStorageModel';
import { IGuideProgramDialogSettingStorageModel } from './storage/guide/IGuideProgramDialogSettingStorageModel';
import { IGuideSizeSettingStorageModel } from './storage/guide/IGuideSizeSettingStorageModel';
import IStorageOperationModel from './storage/IStorageOperationModel';
import { IOnAirSelectStreamSettingStorageModel } from './storage/onair/IOnAirSelectStreamSettingStorageModel';
import OnAirSelectStreamSettingStorageModel from './storage/onair/OnAirSelectStreamSettingStorageModel';
import { IRecordedSelectStreamSettingStorageModel } from './storage/recorded/IRecordedSelectStreamSettingStorageModel';
import { ISendVideoFileSelectHostSettingStorageModel } from './storage/recorded/ISendVideoFileSelectHostSettingStorageModel';
import RecordedSelectStreamSettingStorageModel from './storage/recorded/RecordedSelectStreamSettingStorageModel';
import SendVideoFileSelectHostSettingStorageModel from './storage/recorded/SendVideoFileSelectHostSettingStorageModel';
import { ISettingStorageModel } from './storage/setting/ISettingStorageModel';
import SettingStorageModel from './storage/setting/SettingStorageModel';
import StorageOperationModel from './storage/StorageOperationModel';

/**
 * container に各 Model を登録する
 */
export default (container: Container): void => {
    container.bind<IPWAConfigModel>('IPWAConfigModel').to(PWAConfigModel).inSingletonScope();

    container.bind<IRepositoryModel>('IRepositoryModel').to(RepositoryModel).inSingletonScope();

    container.bind<IConfigApiModel>('IConfigApiModel').to(ConfigApiModel).inSingletonScope();

    container.bind<IChannelsApiModel>('IChannelsApiModel').to(ChannelsApiModel).inSingletonScope();

    container.bind<IReservesApiModel>('IReservesApiModel').to(ReservesApiModel).inSingletonScope();

    container.bind<IScheduleApiModel>('IScheduleApiModel').to(ScheduleApiModel).inSingletonScope();

    container.bind<IStreamApiModel>('IStreamApiModel').to(StreamApiModel).inSingletonScope();

    container.bind<IRecordedApiModel>('IRecordedApiModel').to(RecordedApiModel).inSingletonScope();

    container.bind<IRecordingApiModel>('IRecordingApiModel').to(RecordingApiModel).inSingletonScope();

    container.bind<IRuleApiModel>('IRuleApiModel').to(RuleApiModel).inSingletonScope();

    container.bind<IEncodeApiModel>('IEncodeApiModel').to(EncodeApiModel).inSingletonScope();

    container.bind<IVideoApiModel>('IVideoApiModel').to(VideoApiModel).inSingletonScope();

    container.bind<IDropLogApiModel>('IDropLogApiModel').to(DropLogApiModel).inSingletonScope();

    container.bind<IStorageApiModel>('IStorageApiModel').to(StorageApiModel).inSingletonScope();

    container.bind<IThumbnailApiModel>('IThumbnailApiModel').to(ThumbnailApiModel).inSingletonScope();

    container.bind<IStorageOperationModel>('IStorageOperationModel').to(StorageOperationModel).inSingletonScope();

    container.bind<ISettingStorageModel>('ISettingStorageModel').to(SettingStorageModel).inSingletonScope();

    container.bind<IGuideProgramDialogSettingStorageModel>('IGuideProgramDialogSettingStorageModel').to(GuideProgramDialogSettingStorageModel).inSingletonScope();

    container.bind<IGuideGenreSettingStorageModel>('IGuideGenreSettingStorageModel').to(GuideGenreSettingStorageModel).inSingletonScope();

    container.bind<IGuideSizeSettingStorageModel>('IGuideSizeSettingStorageModel').to(GuideSizeSettingStorageModel).inSingletonScope();

    container.bind<IAddEncodeSettingStorageModel>('IAddEncodeSettingStorageModel').to(AddEncodeSettingStorageModel).inSingletonScope();

    container.bind<IOnAirSelectStreamSettingStorageModel>('IOnAirSelectStreamSettingStorageModel').to(OnAirSelectStreamSettingStorageModel).inSingletonScope();

    container.bind<IRecordedSelectStreamSettingStorageModel>('IRecordedSelectStreamSettingStorageModel').to(RecordedSelectStreamSettingStorageModel).inSingletonScope();

    container.bind<ISendVideoFileSelectHostSettingStorageModel>('ISendVideoFileSelectHostSettingStorageModel').to(SendVideoFileSelectHostSettingStorageModel).inSingletonScope();

    container.bind<IServerConfigModel>('IServerConfigModel').to(ServerConfigModel).inSingletonScope();

    container.bind<IChannelModel>('IChannelModel').to(ChannelModel).inSingletonScope();

    container.bind<ISocketIOModel>('ISocketIOModel').to(SocketIOModel).inSingletonScope();

    container.bind<IScrollPositionState>('IScrollPositionState').to(ScrollPositionState).inSingletonScope();

    container.bind<INavigationState>('INavigationState').to(NavigationState).inSingletonScope();

    container.bind<ISnackbarState>('ISnackbarState').to(SnackbarState).inSingletonScope();

    container.bind<IDashboardState>('IDashboardState').to(DashboardState).inSingletonScope();

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

    container.bind<IRecordedSearchState>('IRecordedSearchState').to(RecordedSearchState).inSingletonScope();

    container.bind<IRecordedDetailState>('IRecordedDetailState').to(RecordedDetailState).inSingletonScope();

    container.bind<IRecordedUploadState>('IRecordedUploadState').to(RecordedUploadState).inSingletonScope();

    container.bind<IRecordedDetailSelectStreamState>('IRecordedDetailSelectStreamState').to(RecordedDetailSelectStreamState).inSingletonScope();

    container.bind<IRecordedStreamingVideoState>('IRecordedStreamingVideoState').to(RecordedStreamingVideoState).inSingletonScope();

    container.bind<IRecordedHLSStreamingVideoState>('IRecordedHLSStreamingVideoState').to(RecordedHLSStreamingVideoState).inSingletonScope();

    container.bind<ISendVideoFileToKodiState>('ISendVideoFileToKodiState').to(SendVideoFileToKodiState).inSingletonScope();

    container.bind<IWatchRecordedInfoState>('IWatchRecordedInfoState').to(WatchRecordedInfoState).inSingletonScope();

    container.bind<IRecordingState>('IRecordingState').to(RecordingState).inSingletonScope();

    container.bind<IEncodeState>('IEncodeState').to(EncodeState).inSingletonScope();

    container.bind<ISearchState>('ISearchState').to(SearchState).inSingletonScope();

    container.bind<IRuleState>('IRuleState').to(RuleState).inSingletonScope();

    container.bind<IAddEncodeState>('IAddEncodeState').to(AddEncodeState).inSingletonScope();

    container.bind<IDropLogDialogState>('IDropLogDialogState').to(DropLogDialogState).inSingletonScope();

    container.bind<IManualReserveState>('IManualReserveState').to(ManualReserveState).inSingletonScope();

    container.bind<IStorageState>('IStorageState').to(StorageState).inSingletonScope();
};
