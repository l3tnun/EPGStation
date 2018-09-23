import { ChannelsApiModel } from '../Model/Api/ChannelsApiModel';
import { ConfigApiModel } from '../Model/Api/ConfigApiModel';
import { EncodingApiModel } from '../Model/Api/EncodingApiModel';
import { RecordedApiModel } from '../Model/Api/RecordedApiModel';
import { ReservesApiModel } from '../Model/Api/ReservesApiModel';
import { RulesApiModel } from '../Model/Api/RulesApiModel';
import { ScheduleApiModel } from '../Model/Api/ScheduleApiModel';
import { StorageApiModel } from '../Model/Api/StorageApiModel';
import { StreamsApiModel } from '../Model/Api/StreamsApiModel';
import { BalloonModel } from '../Model/Balloon/BallonModel';
import { ProgramSettingModel } from '../Model/Program/ProgramSettingModel';
import { RecordedWatchSelectSettingModel } from '../Model/Recorded/RecordedWatchSelectSettingModel';
import { SearchSettingModel } from '../Model/Search/SearchSettingModel';
import { SettingModel } from '../Model/Setting/SettingModel';
import { SnackbarModel } from '../Model/Snackbar/SnackbarModel';
import { StorageModel } from '../Model/Storage/StorageModel';
import { StreamSelectSettingModel } from '../Model/Stream/StreamSelectSettingModel';
import { TabModel } from '../Model/Tab/TabModel';

import BalloonViewModel from './Balloon/BalloonViewModel';
import EncodingDeleteViewModel from './Encoding/EncodingDeleteViewModel';
import EncodingViewModel from './Encoding/EncodingViewModel';
import HeaderViewModel from './HeaderViewModel';
import MainLayoutViewModel from './MainLayoutViewModel';
import NavigationViewModel from './NavigationViewModel';
import ProgramDetailViewModel from './Program/ProgramDetailViewModel';
import ProgramGenreViewModel from './Program/ProgramGenreViewModel';
import ProgramInfoViewModel from './Program/ProgramInfoViewModel';
import ProgramSettingViewModel from './Program/ProgramSettingViewModel';
import ProgramTimeBalloonViewModel from './Program/ProgramTimeBalloonViewModel';
import { ProgramViewModel } from './Program/ProgramViewModel';
import RecordedCleanupViewModel from './Recorded/RecordedCleanupViewModel';
import RecordedInfoViewModel from './Recorded/RecordedInfoViewModel';
import RecordedMenuViewModel from './Recorded/RecordedMenuViewModel';
import RecordedPlayerViewModel from './Recorded/RecordedPlayerViewModel';
import RecordedSearchViewModel from './Recorded/RecordedSearchViewModel';
import RecordedUploadViewModel from './Recorded/RecordedUploadViewModel';
import RecordedViewModel from './Recorded/RecordedViewModel';
import RecordedWatchSelectSettingViewModel from './Recorded/RecordedWatchSelectSettingViewModel';
import RecordedWatchSelectViewModel from './Recorded/RecordedWatchSelectViewModel';
import RecordedWatchViewModel from './Recorded/RecordedWatchViewModel';
import ReservesMenuViewModel from './Reserves/ReservesMenuViewModel';
import { ReservesViewModel } from './Reserves/ReservesViewModel';
import RulesDeleteViewModel from './Rules/RulesDeleteViewModel';
import RulesInfoViewModel from './Rules/RulesInfoViewModel';
import RulesViewModel from './Rules/RulesViewModel';
import SearchSettingViewModel from './Search/SearchSettingViewModel';
import SearchViewModel from './Search/SearchViewModel';
import SettingViewModel from './Setting/SettingViewModel';
import SnackbarViewModel from './Snackbar/SnackbarViewModel';
import StorageViewModel from './Storage/StorageViewModel';
import StreamForcedStopViewModel from './Stream/StreamForcedStopViewModel';
import StreamInfoViewModel from './Stream/StreamInfoViewModel';
import StreamLivePlayerViewModel from './Stream/StreamLivePlayerViewModel';
import StreamProgramCardsViewModel from './Stream/StreamProgramCardsViewModel';
import StreamSelectSettingViewModel from './Stream/StreamSelectSettingViewModel';
import StreamSelectViewModel from './Stream/StreamSelectViewModel';
import StreamWatchViewModel from './Stream/StreamWatchViewModel';
import TabViewModel from './Tab/TabViewModel';
import TopPageViewModel from './TopPageViewModel';
import VideoWatchViewModel from './VideoWatch/VideoWatchViewModel';

import factory from './ViewModelFactory';

/**
 * ViewModelFactory の設定
 */
namespace ViewModelFactorySetting {
    /**
     * ViewModel をセットする
     */
    export const init = (): void => {
        // model
        const snackbarModel = new SnackbarModel();
        const configModel = new ConfigApiModel(snackbarModel);
        const encodingApiModel = new EncodingApiModel(snackbarModel);
        const scheduleApiModel = new ScheduleApiModel(snackbarModel);
        const reservesApiModel = new ReservesApiModel(snackbarModel);
        const balloonModel = new BalloonModel();
        const recordedApiModel = new RecordedApiModel(snackbarModel);
        const channelsApiModel = new ChannelsApiModel(snackbarModel);
        const tabModel = new TabModel();
        const rulesApiModel = new RulesApiModel(snackbarModel);
        const storageApiModel = new StorageApiModel(snackbarModel);
        const storageModel = new StorageModel();
        const streamApiModel = new StreamsApiModel(snackbarModel);
        const streamSelectSettingModel = new StreamSelectSettingModel(storageModel);
        const searchSettingModel = new SearchSettingModel(storageModel);
        const settingModel = new SettingModel(storageModel);
        const programSettingModel = new ProgramSettingModel(storageModel);
        const recordedWatchSelectSettingModel = new RecordedWatchSelectSettingModel(storageModel);

        // reg
        factory.reg('EncodingViewModel', new EncodingViewModel(
            encodingApiModel,
            channelsApiModel,
        ));
        factory.reg('EncodingDeleteViewModel', new EncodingDeleteViewModel(
            balloonModel,
            encodingApiModel,
            snackbarModel,
        ));
        factory.reg('HeaderViewModel', new HeaderViewModel(
            configModel,
            balloonModel,
            channelsApiModel,
        ));
        factory.reg('MainLayoutViewModel', new MainLayoutViewModel(settingModel));
        factory.reg('NavigationViewModel', new NavigationViewModel(
            configModel,
            settingModel,
        ));
        factory.reg('TopPageViewModel', new TopPageViewModel(reservesApiModel));
        factory.reg('ProgramViewModel', new ProgramViewModel(
            configModel,
            scheduleApiModel,
            reservesApiModel,
            settingModel,
            programSettingModel,
        ));
        factory.reg('SnackbarViewModel', new SnackbarViewModel(snackbarModel));
        factory.reg('BalloonViewModel', new BalloonViewModel(balloonModel));
        factory.reg('ProgramInfoViewModel', new ProgramInfoViewModel(
            reservesApiModel,
            balloonModel,
            configModel,
            snackbarModel,
        ));
        factory.reg('ProgramTimeBalloonViewModel', new ProgramTimeBalloonViewModel(
            configModel,
            balloonModel,
            snackbarModel,
        ));
        factory.reg('ProgramGenreViewModel', new ProgramGenreViewModel(
            balloonModel,
            snackbarModel,
            storageModel,
        ));
        factory.reg('ProgramSettingViewModel', new ProgramSettingViewModel(
            programSettingModel,
            snackbarModel,
        ));
        factory.reg('ProgramDetailViewModel', new ProgramDetailViewModel(
            scheduleApiModel,
            reservesApiModel,
            configModel,
            snackbarModel,
        ));
        factory.reg('RecordedViewModel', new RecordedViewModel(
            recordedApiModel,
            channelsApiModel,
            settingModel,
            snackbarModel,
        ));
        factory.reg('RecordedUploadViewModel', new RecordedUploadViewModel(
            channelsApiModel,
            rulesApiModel,
            recordedApiModel,
            snackbarModel,
            balloonModel,
        ));
        factory.reg('RecordedWatchSelectSettingViewModel', new RecordedWatchSelectSettingViewModel(
            recordedWatchSelectSettingModel,
            snackbarModel,
        ));
        factory.reg('RecordedWatchSelectViewModel', new RecordedWatchSelectViewModel(
            configModel,
            balloonModel,
            recordedWatchSelectSettingModel,
        ));
        factory.reg('RecordedWatchViewModel', new RecordedWatchViewModel(
            recordedApiModel,
            channelsApiModel,
        ));
        factory.reg('RecordedCleanupViewModel', new RecordedCleanupViewModel(
            recordedApiModel,
            snackbarModel,
            balloonModel,
        ));
        factory.reg('RecordedInfoViewModel', new RecordedInfoViewModel(
            configModel,
            channelsApiModel,
            recordedApiModel,
            streamApiModel,
            balloonModel,
            tabModel,
            settingModel,
        ));
        factory.reg('RecordedMenuViewModel', new RecordedMenuViewModel(
            balloonModel,
            recordedApiModel,
            snackbarModel,
            configModel,
        ));
        factory.reg('RecordedPlayerViewModel', new RecordedPlayerViewModel(
            balloonModel,
        ));
        factory.reg('RecordedSearchViewModel', new RecordedSearchViewModel(
            balloonModel,
            recordedApiModel,
        ));
        factory.reg('TabViewModel', new TabViewModel(tabModel));
        factory.reg('ReservesViewModel', new ReservesViewModel(
            reservesApiModel,
            channelsApiModel,
            scheduleApiModel,
            settingModel,
        ));
        factory.reg('ReservesMenuViewModel', new ReservesMenuViewModel(
            balloonModel,
            reservesApiModel,
            snackbarModel,
        ));
        factory.reg('RulesViewModel', new RulesViewModel(
            rulesApiModel,
            channelsApiModel,
            reservesApiModel,
            snackbarModel,
            settingModel,
        ));
        factory.reg('RulesDeleteViewModel', new RulesDeleteViewModel(
            rulesApiModel,
            balloonModel,
            snackbarModel,
        ));
        factory.reg('RulesInfoViewModel', new RulesInfoViewModel(
            balloonModel,
            channelsApiModel,
        ));
        factory.reg('SearchSettingViewModel', new SearchSettingViewModel(
            searchSettingModel,
            snackbarModel,
        ));
        factory.reg('SearchViewModel', new SearchViewModel(
            scheduleApiModel,
            reservesApiModel,
            rulesApiModel,
            configModel,
            channelsApiModel,
            searchSettingModel,
            snackbarModel,
        ));
        factory.reg('StorageViewModel', new StorageViewModel(
            balloonModel,
            storageApiModel,
        ));
        factory.reg('StreamProgramCardsViewModel', new StreamProgramCardsViewModel(
            scheduleApiModel,
            tabModel,
            configModel,
        ));
        factory.reg('StreamSelectSettingViewModel', new StreamSelectSettingViewModel(
            streamSelectSettingModel,
            snackbarModel,
        ));
        factory.reg('StreamSelectViewModel', new StreamSelectViewModel(
            configModel,
            streamApiModel,
            balloonModel,
            snackbarModel,
            settingModel,
            streamSelectSettingModel,
        ));
        factory.reg('StreamInfoViewModel', new StreamInfoViewModel(
            streamApiModel,
            configModel,
            snackbarModel,
            settingModel,
        ));
        factory.reg('StreamLivePlayerViewModel', new StreamLivePlayerViewModel(
            balloonModel,
        ));
        factory.reg('StreamForcedStopViewModel', new StreamForcedStopViewModel(
            streamApiModel,
        ));
        factory.reg('StreamWatchViewModel', new StreamWatchViewModel(
            streamApiModel,
            configModel,
            settingModel,
            snackbarModel,
        ));
        factory.reg('SettingViewModel', new SettingViewModel(
            settingModel,
            snackbarModel,
        ));
        factory.reg('VideoWatchViewModel', new VideoWatchViewModel(
            recordedApiModel,
            channelsApiModel,
            streamApiModel,
        ));
    };
}

export default ViewModelFactorySetting;

