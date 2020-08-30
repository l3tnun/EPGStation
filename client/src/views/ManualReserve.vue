<template>
    <v-content>
        <TitleBar ref="title" title="番組詳細予約"></TitleBar>
        <transition name="page">
            <div ref="appContent" class="app-content manual-reserve pa-3 mx-auto">
                <ManualReserveProgramInfo :program="manualReserveState.getProgramInfo()"></ManualReserveProgramInfo>
            </div>
        </transition>
    </v-content>
</template>

<script lang="ts">
import ManualReserveProgramInfo from '@/components/manualReserve/ManualReserveProgramInfo.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IManualReserveState from '@/model/state/reserve/manual/IManualReserveState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import ISettingStorageModel, { ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import { Component, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';
import * as apid from '../../../api';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
        ManualReserveProgramInfo,
    },
})
export default class ManualReserve extends Vue {
    private manualReserveState: IManualReserveState = container.get<IManualReserveState>('IManualReserveState');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private settingValue: ISettingValue = container.get<ISettingStorageModel>('ISettingStorageModel').getSavedValue();
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (() => {}).bind(this);

    public created(): void {
        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
    }

    /**
     * ページ更新時に呼ばれる
     */
    public beforeRouteUpdate(to: Route, from: Route, next: () => void): void {
        this.savePageInfo();
        next();
    }

    /**
     * ページ離脱時に呼ばれる
     */
    public beforeRouteLeave(to: Route, from: Route, next: () => void): void {
        this.savePageInfo();
        next();
    }

    /**
     * ページ情報を保存する
     */
    private savePageInfo(): void {
        // TODO 実装
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.$nextTick(async () => {
            // fetch data
            if (typeof this.$route.query.programId === 'string') {
                await this.manualReserveState
                    .fetchProgramInfo(parseInt(this.$route.query.programId, 10), this.settingValue.isHalfWidthDisplayed)
                    .catch(err => {
                        this.snackbarState.open({
                            color: 'error',
                            text: '番組情報取得に失敗',
                        });
                    });
            }

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }
}
</script>

<style lang="sass" scoped>
.manual-reserve
    max-width: 800px
</style>
