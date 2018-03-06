import * as m from 'mithril';
import ProgramComponent from './Component/Program/ProgramComponent';
import ProgramSettingComponent from './Component/Program/Setting/ProgramSettingComponent';
import RecordedComponent from './Component/Recorded/RecordedComponent';
import ReservesComponent from './Component/Reserves/ReservesComponent';
import RulesComponent from './Component/Rules/RulesComponent';
import SearchComponent from './Component/Search/SearchComponent';
import SettingComponent from './Component/Setting/SettingComponent';
import StreamProgramComponent from './Component/Stream/StreamProgramComponent';
import StreamWatchComponent from './Component/Stream/StreamWatchComponent';
import TopPageComponent from './Component/TopPage/TopPageComponent';
import Util from './Util/Util';
import factory from './ViewModel/ViewModelFactory';
import ViewModelFactorySetting from './ViewModel/ViewModelFactorySetting';

ViewModelFactorySetting.init();

// android では web アプリ化
if (Util.uaIsAndroid()) {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'mobile-web-app-capable');
    meta.setAttribute('content', 'yes');
    document.getElementsByTagName('head')[0].appendChild(meta);
}

// 設定情報の初期化
factory.get('SettingViewModel').init();
factory.get('ProgramSettingViewModel').init();

m.route.prefix('#!');
m.route(document.body, '/', {
    '/': TopPageComponent,
    '/stream/program': StreamProgramComponent,
    '/stream/watch': StreamWatchComponent,
    '/program': ProgramComponent,
    '/program/setting': ProgramSettingComponent,
    '/recorded': RecordedComponent,
    '/reserves': ReservesComponent,
    '/rules': RulesComponent,
    '/search': SearchComponent,
    '/setting': SettingComponent,
});

