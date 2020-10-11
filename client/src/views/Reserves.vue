<template>
    <v-content>
        <EditTitleBar
            v-if="isEditMode === true"
            :title="selectedTitle"
            :isEditMode.sync="isEditMode"
            v-on:exit="onFinishEdit"
            v-on:selectall="onSelectAll"
            v-on:delete="onMultiplueDeletion"
        ></EditTitleBar>
        <TitleBar v-else :title="title">
            <template v-slot:menu>
                <ReservesMainMenu v-on:edit="onEdit"></ReservesMainMenu>
            </template>
        </TitleBar>
        <transition name="page">
            <div v-if="reservesState.getReserves().length > 0" ref="appContent" class="app-content pa-2">
                <div v-bind:style="contentWrapStyle">
                    <ReserveItems :reserves="reservesState.getReserves()" :isEditMode.sync="isEditMode" v-on:selected="selectItem"></ReserveItems>
                </div>
                <Pagination :total="reservesState.getTotal()" :pageSize="settingValue.reservesLength"></Pagination>
            </div>
        </transition>
        <div style="visibility: hidden">dummy</div>
        <ReserveMultipleDeletionDialog
            :isOpen.sync="isOpenMultiplueDeletionDialog"
            :total="reservesState.getSelectedCnt()"
            v-on:delete="onExecuteMultiplueDeletion"
        ></ReserveMultipleDeletionDialog>
    </v-content>
</template>

<script lang="ts">
import Pagination from '@/components/pagination/Pagination.vue';
import ReserveItems from '@/components/reserves/ReserveItems.vue';
import ReserveMultipleDeletionDialog from '@/components/reserves/ReserveMultipleDeletionDialog.vue';
import ReservesMainMenu from '@/components/reserves/ReservesMainMenu.vue';
import Snackbar from '@/components/snackbar/Snackbar.vue';
import EditTitleBar from '@/components/titleBar/EditTitleBar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IReservesState from '@/model/state/reserve/IReservesState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';
import { Component, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';
import * as apid from '../../../api';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        EditTitleBar,
        TitleBar,
        ReservesMainMenu,
        ReserveItems,
        Pagination,
        ReserveMultipleDeletionDialog,
    },
})
export default class Reserves extends Vue {
    public isEditMode: boolean = false;
    public isOpenMultiplueDeletionDialog: boolean = false;

    private isVisibilityHidden: boolean = false;
    private reservesState: IReservesState = container.get<IReservesState>('IReservesState');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private settingValue: ISettingValue | null = null;
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async (): Promise<void> => {
        await this.reservesState.fetchData(this.createFetchDataOption());
    }).bind(this);

    get selectedTitle(): string {
        return `${this.reservesState.getSelectedCnt()} 件選択`;
    }

    /**
     * title
     */
    get title(): string {
        switch (this.$route.query.type) {
            case 'conflict':
                return '競合';
            case 'overlap':
                return '重複';
            case 'skip':
                return '除外';
            case 'normal':
            default:
                return '予約';
        }
    }

    get contentWrapStyle(): any {
        return this.isVisibilityHidden === false
            ? {}
            : {
                  opacity: 0,
                  visibility: 'hidden',
              };
    }

    public created(): void {
        this.settingValue = this.setting.getSavedValue();

        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
    }

    public beforeRouteUpdate(to: Route, from: Route, next: () => void): void {
        this.isVisibilityHidden = true;

        this.$nextTick(() => {
            next();
        });
    }

    public onEdit(): void {
        this.isEditMode = true;
    }

    public onFinishEdit(): void {
        this.reservesState.clearSelect();
    }

    public onSelectAll(): void {
        this.reservesState.selectAll();
    }

    public selectItem(reserveId: apid.ReserveId): void {
        this.reservesState.select(reserveId);
    }

    public onMultiplueDeletion(): void {
        this.isOpenMultiplueDeletionDialog = true;
    }

    public async onExecuteMultiplueDeletion(): Promise<void> {
        this.isOpenMultiplueDeletionDialog = false;
        this.isEditMode = false;
        try {
            await this.reservesState.multiplueDeletion();
            this.snackbarState.open({
                color: 'success',
                text: '選択した番組の予約をキャンセルしました。',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: '一部番組のキャンセルに失敗しました。',
            });
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.reservesState.clearDate();
        this.$nextTick(async () => {
            await this.reservesState.fetchData(this.createFetchDataOption()).catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '予約データ取得に失敗',
                });
                console.error(err);
            });

            this.isVisibilityHidden = false;

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    /**
     * 予約データ取得時のオプションを生成する
     * @return GetReserveOption
     */
    private createFetchDataOption(): apid.GetReserveOption {
        if (this.settingValue === null) {
            throw new Error('SettingValueIsNull');
        }

        const type = this.$route.query.type;

        return {
            type: typeof type === 'undefined' ? 'all' : type === 'normal' || type === 'conflict' || type === 'overlap' || type === 'skip' ? type : 'normal',
            isHalfWidth: this.settingValue.isHalfWidthDisplayed,
            offset: (Util.getPageNum(this.$route) - 1) * this.settingValue.reservesLength,
            limit: this.settingValue.reservesLength,
        };
    }
}
</script>
