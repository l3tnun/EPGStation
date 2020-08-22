<template>
    <v-content>
        <TitleBar :title="title">
            <template v-slot:menu>
                <ReservesMainMenu></ReservesMainMenu>
            </template>
        </TitleBar>
        <transition name="page">
            <div v-if="reservesState.getReserves().length > 0" ref="appContent" class="app-content pa-2">
                <div v-bind:style="contentWrapStyle">
                    <ReserveItems :reserves="reservesState.getReserves()"></ReserveItems>
                </div>
                <Pagination :total="reservesState.getTotal()" :pageSize="settingValue.reservesLength"></Pagination>
            </div>
        </transition>
        <div style="visibility: hidden;">dummy</div>
    </v-content>
</template>

<script lang="ts">
import Pagination from '@/components/pagination/Pagination.vue';
import ReserveItems from '@/components/reserves/ReserveItems.vue';
import ReservesMainMenu from '@/components/reserves/ReservesMainMenu.vue';
import Snackbar from '@/components/snackbar/Snackbar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IReservesState from '@/model/state/reserve/IReservesState';
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
        ReservesMainMenu,
        ReserveItems,
        Pagination,
    },
})
export default class Reserves extends Vue {
    private isVisibilityHidden: boolean = false;
    private reservesState: IReservesState = container.get<IReservesState>('IReservesState');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private settingValue: ISettingValue | null = null;
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async () => {
        await this.reservesState.fetchData(this.createFetchDataOption());
    }).bind(this);

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
            type:
                typeof type === 'undefined'
                    ? 'all'
                    : type === 'normal' || type === 'conflict' || type === 'overlap' || type === 'skip'
                    ? type
                    : 'normal',
            isHalfWidth: this.settingValue.isReservesHalfWidthDisplayed,
            offset: (Util.getPageNum(this.$route) - 1) * this.settingValue.reservesLength,
            limit: this.settingValue.reservesLength,
        };
    }
}
</script>
