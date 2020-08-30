<template>
    <v-content>
        <TitleBar ref="title" title="番組詳細予約"></TitleBar>
        <transition name="page">
            <div ref="appContent" class="app-content manual-reserve pa-3 mx-auto">
                <ManualReserveProgramInfo :program="manualReserveState.getProgramInfo()"></ManualReserveProgramInfo>
                <div class="pt-2"></div>
                <ManualReserveOption
                    :isEditMode="isEditMode"
                    v-on:cancel="cancel"
                    v-on:add="add"
                    v-on:update="update"
                ></ManualReserveOption>
            </div>
        </transition>
    </v-content>
</template>

<script lang="ts">
import ManualReserveOption from '@/components/manualReserve/ManualReserveOption.vue';
import ManualReserveProgramInfo from '@/components/manualReserve/ManualReserveProgramInfo.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IManualReserveState from '@/model/state/reserve/manual/IManualReserveState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import ISettingStorageModel, { ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';
import { Component, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';
import * as apid from '../../../api';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
        ManualReserveProgramInfo,
        ManualReserveOption,
    },
})
export default class ManualReserve extends Vue {
    public isEditMode: boolean = false;

    private manualReserveState: IManualReserveState = container.get<IManualReserveState>('IManualReserveState');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private settingValue: ISettingValue = container.get<ISettingStorageModel>('ISettingStorageModel').getSavedValue();
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async () => {
        if (this.manualReserveState.isTimeSpecification === true) {
            // TODO 時刻指定予約
        } else {
            await this.fetchProgramInfo().catch(err => {});
        }
    }).bind(this);

    private programId: apid.ProgramId | null = null;
    private reserveId: apid.ReserveId | null = null;

    public created(): void {
        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
    }

    /**
     * キャンセル
     */
    public cancel(): void {
        this.$router.back();
    }

    /**
     * 追加
     */
    public async add(): Promise<void> {
        try {
            await this.manualReserveState.addReserve();
            this.snackbarState.open({
                color: 'success',
                text: '予約を追加しました。',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: '予約の追加に失敗しました。',
            });

            return;
        }

        await Util.sleep(800);
        this.$router.back();
    }

    /**
     * 更新
     */
    public async update(): Promise<void> {
        if (this.reserveId === null) {
            return;
        }

        try {
            await this.manualReserveState.updateReserve(this.reserveId);
            this.snackbarState.open({
                color: 'success',
                text: '予約を更新しました。',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: '予約の更新に失敗しました。',
            });

            return;
        }

        await Util.sleep(800);
        this.$router.back();
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
        this.programId = null;
        this.reserveId = null;
        this.manualReserveState.init();

        const finnalize = async () => {
            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        };

        this.$nextTick(async () => {
            // fetch data
            if (typeof this.$route.query.reserveId === 'string') {
                this.isEditMode = true;
                this.reserveId = parseInt(this.$route.query.reserveId, 10);

                let reserveItem: apid.ReserveItem;
                try {
                    reserveItem = await this.manualReserveState.getReserveItem(
                        this.reserveId,
                        this.settingValue.isHalfWidthDisplayed,
                    );
                } catch (err) {
                    this.snackbarState.open({
                        color: 'error',
                        text: '予約情報取得に失敗',
                    });
                    console.error(err);
                    await finnalize();

                    return;
                }

                // 予約情報を入力に反映
                this.manualReserveState.setOptions(reserveItem);

                // 予約情報取得
                if (typeof reserveItem.programId !== 'undefined') {
                    this.programId = reserveItem.programId;
                    await this.fetchProgramInfo().catch(err => {});
                } else {
                    // TODO 時刻指定予約
                }
            } else if (typeof this.$route.query.programId === 'string') {
                this.isEditMode = false;

                // 予約情報取得
                this.programId = parseInt(this.$route.query.programId, 10);
                await this.fetchProgramInfo().catch(err => {});
            }

            await finnalize();
        });
    }

    /**
     * program id から番組情報を更新する
     */
    private async fetchProgramInfo(): Promise<void> {
        if (this.programId === null) {
            return;
        }
        await this.manualReserveState
            .fetchProgramInfo(this.programId, this.settingValue.isHalfWidthDisplayed)
            .catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '番組情報取得に失敗',
                });
                console.error(err);
                throw err;
            });
    }
}
</script>

<style lang="sass" scoped>
.manual-reserve
    max-width: 800px
</style>
