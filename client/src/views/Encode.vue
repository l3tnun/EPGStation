<template>
    <v-content>
        <TitleBar title="エンコード"></TitleBar>
        <transition name="page">
            <div ref="appContent" class="app-content pa-2">
                <div>encode info page</div>
                <div style="visibility: hidden;">dummy</div>
            </div>
        </transition>
    </v-content>
</template>

<script lang="ts">
import Snackbar from '@/components/snackbar/Snackbar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IEncodeState from '@/model/state/encode/IEncodeState';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import ISettingStorageModel, { ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import { Component, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../api';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
        Snackbar,
    },
})
export default class Encode extends Vue {
    private encodeState: IEncodeState = container.get<IEncodeState>('IEncodeState');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private settingValue: ISettingValue | null = null;
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async () => {
        await this.encodeState.fetchData(true); // TODO use setting value
    }).bind(this);

    public created(): void {
        this.settingValue = this.setting.getSavedValue();

        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
    }

    /**
     * 指定した id のエンコードをキャンセルする
     * @param encodeId: apid.EncodeId
     * @return Promise<void>
     */
    public async cancel(encodeId: apid.EncodeId): Promise<void> {
        try {
            await this.encodeState.cancel(encodeId);
            this.snackbarState.open({
                color: 'success',
                text: 'エンコードをキャンセルしました',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: 'エンコードのキャンセルに失敗しました',
            });

            console.error(err);
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.encodeState.clearData();

        this.$nextTick(async () => {
            // TODO use setting value
            await this.encodeState.fetchData(true).catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: 'エンコード情報取得に失敗',
                });

                console.error(err);
            });

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }
}
</script>
