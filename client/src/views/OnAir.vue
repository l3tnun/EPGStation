<template>
    <v-content>
        <TitleBar title="放映中"></TitleBar>
        <transition name="page">
            <div>on air</div>
        </transition>
    </v-content>
</template>

<script lang="ts">
import Snackbar from '@/components/snackbar/Snackbar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IOnAirState from '@/model/state/onair/IOnAirState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import ISettingStorageModel, { ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';
import { Component, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
        Snackbar,
    },
})
export default class OnAir extends Vue {
    private onAirState: IOnAirState = container.get<IOnAirState>('IOnAirState');
    private settingValue: ISettingValue = container.get<ISettingStorageModel>('ISettingStorageModel').getSavedValue();
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async () => {
        await this.fetchData();
    }).bind(this);

    public created(): void {
        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.onAirState.clearData();
        this.$nextTick(async () => {
            await this.fetchData().catch(() => {});

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    /**
     * 番組データ取得
     * @return Promise<void>
     */
    private async fetchData(): Promise<void> {
        await this.onAirState
            .fetchData({
                isHalfWidth: this.settingValue.isOnAirHalfWidthDisplayed,
            })
            .catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '番組情報取得に失敗',
                });

                throw err;
            });
    }
}
</script>
