<template>
    <v-content>
        <TitleBar title="エンコード"></TitleBar>
        <transition name="page">
            <div ref="appContent" class="mx-auto app-content pa-2">
                <div v-if="encodeState.getEncodeInfo().runningItems.length > 0">
                    <div class="title">エンコード中</div>
                    <EncodeItems :items="encodeState.getEncodeInfo().runningItems"></EncodeItems>
                </div>
                <div v-if="encodeState.getEncodeInfo().waitItems.length > 0">
                    <div class="title pt-2">待機中</div>
                    <EncodeItems :items="encodeState.getEncodeInfo().waitItems"></EncodeItems>
                </div>
                <div style="visibility: hidden;">dummy</div>
            </div>
        </transition>
    </v-content>
</template>

<script lang="ts">
import EncodeItems from '@/components/encode/EncodeItems.vue';
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
        EncodeItems,
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
        await this.encodeState.fetchData(this.isHalfWidth());
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

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.encodeState.clearData();

        this.$nextTick(async () => {
            await this.encodeState.fetchData(this.isHalfWidth()).catch(err => {
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

    /**
     * 半角で取得するか
     * @return boolean
     */
    private isHalfWidth(): boolean {
        return this.settingValue === null ? true : this.settingValue.isEncodeHalfWidthDisplayed;
    }
}
</script>

<style lang="sass" scoped>
.app-content
    max-width: 800px
</style>
