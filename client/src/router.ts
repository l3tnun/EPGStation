import Vue from 'vue';
import Router from 'vue-router';
import { Position, Route } from 'vue-router/types/router';
import container from './model/ModelContainer';
import IScrollPositionState from './model/state/IScrollPositionState';
import Dashboard from './views/Dashboard.vue';
import Encode from './views/Encode.vue';
import Guide from './views/Guide.vue';
import GuideSizeSetting from './views/GuideSizeSetting.vue';
import ManualReserve from './views/ManualReserve.vue';
import OnAir from './views/OnAir.vue';
import Recorded from './views/Recorded.vue';
import RecordedDetail from './views/RecordedDetail.vue';
import RecordedUpload from './views/RecordedUpload.vue';
import Recording from './views/Recording.vue';
import Reserves from './views/Reserves.vue';
import Rule from './views/Rule.vue';
import Search from './views/Search.vue';
import Settings from './views/Settings.vue';
import Storages from './views/Storages.vue';
import WatchOnAir from './views/WatchOnAir.vue';
import WatchRecorded from './views/WatchRecorded.vue';
import WatchRecordedStreaming from './views/WatchRecordedStreaming.vue';

Vue.use(Router);

export default new Router({
    routes: [
        {
            path: '/',
            name: 'dashboard',
            component: Dashboard,
        },
        {
            path: '/onair',
            name: 'onair',
            component: OnAir,
        },
        {
            path: '/onair/watch',
            name: 'watch-onair',
            component: WatchOnAir,
        },
        {
            path: '/guide',
            name: 'guide',
            component: Guide,
        },
        {
            path: '/guide/setting',
            name: 'guide-setting',
            component: GuideSizeSetting,
        },
        {
            path: '/reserves',
            name: 'reserves',
            component: Reserves,
        },
        {
            path: '/reserves/manual',
            name: 'manual-reserve',
            component: ManualReserve,
        },
        {
            path: '/recording',
            name: 'recording',
            component: Recording,
        },
        {
            path: '/recorded',
            name: 'recorded',
            component: Recorded,
        },
        {
            path: '/recorded/upload',
            name: 'recorded-upload',
            component: RecordedUpload,
        },
        {
            path: '/recorded/watch',
            name: 'recorded-watch',
            component: WatchRecorded,
        },
        {
            path: '/recorded/detail/:id',
            name: 'recorded-detail',
            component: RecordedDetail,
        },
        {
            path: '/recorded/streaming/:id',
            name: 'recorded-streaming',
            component: WatchRecordedStreaming,
        },
        {
            path: '/encode',
            name: 'encode',
            component: Encode,
        },
        {
            path: '/search',
            name: 'search',
            component: Search,
        },
        {
            path: '/rule',
            name: 'rule',
            component: Rule,
        },
        {
            path: '/settings',
            name: 'settings',
            component: Settings,
        },
        {
            path: '/storages',
            name: 'storages',
            component: Storages,
        },
    ],
    scrollBehavior: async (_to: Route, _from: Route, savedPosition: Position | void): Promise<Position> => {
        // ページデータが取得されるまで待つ
        const scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
        await scrollState.onDoneGetData();

        return savedPosition ? savedPosition : { x: 0, y: 0 };
    },
});
