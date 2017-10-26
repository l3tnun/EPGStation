import factory from './ViewModelFactory';
import { ConfigApiModel } from '../Model/Api/ConfigApiModel';
import { ScheduleApiModel } from '../Model/Api/ScheduleApiModel';
import { ReservesApiModel } from '../Model/Api/ReservesApiModel';
import { SnackbarModel } from '../Model/Snackbar/SnackbarModel';
import { BalloonModel } from '../Model/Balloon/BallonModel';
import { RecordedApiModel } from '../Model/Api/RecordedApiModel';
import { ChannelsApiModel } from '../Model/Api/ChannelsApiModel';
import { TabModel } from '../Model/Tab/TabModel';
import { RulesApiModel } from '../Model/Api/RulesApiModel';
import { StorageApiModel } from '../Model/Api/StorageApiModel';
import { StorageModel } from '../Model/Storage/StorageModel';
import { StreamsApiModel } from '../Model/Api/StreamsApiModel';
import { SettingModel } from '../Model/Setting/SettingModel';
import HeaderViewModel from './HeaderViewModel';
import NavigationViewModel from './NavigationViewModel';
import ProgramViewModel from './Program/ProgramViewModel';
import SnackbarViewModel from './Snackbar/SnackbarViewModel';
import BalloonViewModel from './Balloon/BalloonViewModel';
import ProgramInfoViewModel from './Program/ProgramInfoViewModel';
import ProgramTimeBalloonViewModel from './Program/ProgramTimeBalloonViewModel';
import ProgramGenreViewModel from './Program/ProgramGenreViewModel';
import RecordedViewModel from './Recorded/RecordedViewModel';
import RecordedInfoViewModel from './Recorded/RecordedInfoViewModel';
import RecordedMenuViewModel from './Recorded/RecordedMenuViewModel';
import RecordedSearchViewModel from './Recorded/RecordedSearchViewModel';
import TabViewModel from './Tab/TabViewModel';
import ReservesViewModel from './Reserves/ReservesViewModel';
import ReservesMenuViewModel from './Reserves/ReservesMenuViewModel';
import RulesViewModel from './Rules/RulesViewModel';
import RulesDeleteViewModel from './Rules/RulesDeleteViewModel';
import RulesInfoViewModel from './Rules/RulesInfoViewModel';
import SearchViewModel from './Search/SearchViewModel';
import StorageViewModel from './Storage/StorageViewModel';
import StreamProgramCardsViewModel from './Stream/StreamProgramCardsViewModel';
import StreamSelectViewModel from './Stream/StreamSelectViewModel';
import StreamInfoViewModel from './Stream/StreamInfoViewModel';
import StreamForcedStopViewModel from './Stream/StreamForcedStopViewModel';
import StreamWatchViewModel from './Stream/StreamWatchViewModel';
import SettingViewModel from './Setting/SettingViewModel';

/**
* ViewModelFactory の設定
*/
namespace ViewModelFactorySetting {
    /**
    * ViewModel をセットする
    */
    export const init = (): void => {
        // model
        let snackbarModel = new SnackbarModel();
        let configModel = new ConfigApiModel(snackbarModel);
        let scheduleApiModel = new ScheduleApiModel(snackbarModel);
        let reservesApiModel = new ReservesApiModel(snackbarModel);
        let balloonModel = new BalloonModel();
        let recordedApiModel = new RecordedApiModel(snackbarModel);
        let channelsApiModel = new ChannelsApiModel(snackbarModel);
        let tabModel = new TabModel();
        let rulesApiModel = new RulesApiModel(snackbarModel);
        let storageApiModel = new StorageApiModel(snackbarModel);
        let storageModel = new StorageModel();
        let streamApiModel = new StreamsApiModel(snackbarModel);
        let settingModel = new SettingModel(storageModel);

        //reg
        factory.reg('HeaderViewModel', new HeaderViewModel(
            configModel,
            balloonModel,
            channelsApiModel,
        ));
        factory.reg('NavigationViewModel', new NavigationViewModel(configModel));
        factory.reg('ProgramViewModel', new ProgramViewModel(
            scheduleApiModel,
            reservesApiModel,
            settingModel,
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
            balloonModel,
            snackbarModel,
        ));
        factory.reg('ProgramGenreViewModel', new ProgramGenreViewModel(
            balloonModel,
            snackbarModel,
            storageModel,
        ));
        factory.reg('RecordedViewModel', new RecordedViewModel(
            recordedApiModel,
            channelsApiModel,
            settingModel,
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
        factory.reg('RecordedSearchViewModel', new RecordedSearchViewModel(
            balloonModel,
            recordedApiModel,
        ));
        factory.reg('TabViewModel', new TabViewModel(tabModel));
        factory.reg('ReservesViewModel', new ReservesViewModel(
            reservesApiModel,
            channelsApiModel,
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
        factory.reg('SearchViewModel', new SearchViewModel(
            scheduleApiModel,
            reservesApiModel,
            rulesApiModel,
            configModel,
            channelsApiModel,
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
        factory.reg('StreamSelectViewModel', new StreamSelectViewModel(
            configModel,
            balloonModel,
            snackbarModel,
            settingModel,
        ));
        factory.reg('StreamInfoViewModel', new StreamInfoViewModel(
            streamApiModel,
            configModel,
            snackbarModel,
            settingModel,
        ));
        factory.reg('StreamForcedStopViewModel', new StreamForcedStopViewModel(
            streamApiModel,
        ));
        factory.reg('StreamWatchViewModel', new StreamWatchViewModel(
            streamApiModel,
            snackbarModel,
        ));
        factory.reg('SettingViewModel', new SettingViewModel(
            settingModel,
            snackbarModel,
        ));
    }
}

export default ViewModelFactorySetting;

