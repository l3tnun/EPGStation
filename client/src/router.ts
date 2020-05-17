import Vue from 'vue';
import Router from 'vue-router';
import container from './model/ModelContainer';
import IScrollPositionState from './model/state/IScrollPositionState';
import Guide from './views/Guide.vue';
import Main from './views/Main.vue';
import Recorded from './views/Recorded.vue';
import RecordedDetail from './views/RecordedDetail.vue';
import Reserves from './views/Reserves.vue';
import Rule from './views/Rule.vue';
import Search from './views/Search.vue';
import Settings from './views/Settings.vue';

Vue.use(Router);

export default new Router({
    routes: [
        {
            path: '/',
            name: 'top',
            component: Main,
        },
        {
            path: '/guide',
            name: 'guide',
            component: Guide,
        },
        {
            path: '/reserves',
            name: 'reserves',
            component: Reserves,
        },
        {
            path: '/recorded',
            name: 'recorded',
            component: Recorded,
        },
        {
            path: '/recorded/detail/:id',
            name: 'recorded-detail',
            component: RecordedDetail,
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
    ],
    scrollBehavior: async (_to, _from, savedPosition) => {
        // ページデータが取得されるまで待つ
        const scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
        await scrollState.onDoneGetData();

        return savedPosition ? savedPosition : { x: 0, y: 0 };
    },
});
