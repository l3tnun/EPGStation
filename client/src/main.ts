// tslint:disable-next-line:no-import-side-effect
import 'reflect-metadata';
import smoothscroll from 'smoothscroll-polyfill';
import Vue from 'vue';
import DatetimePicker from 'vuetify-datetime-picker';
import App from './App.vue';
import IChannelModel from './model/channels/IChannelModel';
import container from './model/ModelContainer';
import setter from './model/ModelContainerSetter';
import IPWAConfigModel from './model/pwa/IPWAConfigModel';
import IServerConfigModel from './model/serverConfig/IServerConfigModel';
import vuetify from './plugins/vuetify';
import router from './router';

setter(container);

smoothscroll.polyfill();

(async (): Promise<void> => {
    // server config の取得
    const serverConfiModel = container.get<IServerConfigModel>('IServerConfigModel');
    await serverConfiModel.fetchConfig().catch(err => {
        console.error('get server config error');
        console.error(err);
    });

    // Web app 設定
    container.get<IPWAConfigModel>('IPWAConfigModel').setting();

    // 放送局情報の取得
    const channelModel = container.get<IChannelModel>('IChannelModel');
    await channelModel.fetchChannels().catch(err => {
        console.error('get channels error');
        console.error(err);
    });

    Vue.config.productionTip = false;

    Vue.use(DatetimePicker);

    new Vue({
        router,
        vuetify,
        // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
        render: h => h(App),
    }).$mount('#app');
})();
