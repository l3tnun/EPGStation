<template>
    <v-content>
        <TitleBar title="録画済み"></TitleBar>
        <transition name="page">
            <div v-if="recordedState.getRecorded().length > 0" ref="appContent" class="app-content pa-1">
                <div v-bind:style="contentWrapStyle">
                    <RecordedItems
                        :recorded="recordedState.getRecorded()"
                        v-on:detail="gotoDetail"
                        v-on:stopEncode="stopEncode"
                    ></RecordedItems>
                    <Pagination :total="recordedState.getTotal()" :pageSize="settingValue.recordedLength"></Pagination>
                    <div style="visibility: hidden;">dummy</div>
                </div>
            </div>
        </transition>
        <Snackbar></Snackbar>
    </v-content>
</template>

<script lang="ts">
import Pagination from '@/components/pagination/Pagination.vue';
import RecordedItems from '@/components/recorded/RecordedItems.vue';
import Snackbar from '@/components/snackbar/Snackbar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IRecordedState from '@/model/state/recorded/IRecordedState';
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
        RecordedItems,
        Pagination,
        Snackbar,
    },
})
export default class Recorded extends Vue {
    private isVisibilityHidden: boolean = false;
    private recordedState: IRecordedState = container.get<IRecordedState>('IRecordedState');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private settingValue: ISettingValue | null = null;
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async () => {
        await this.recordedState.fetchData(this.createFetchDataOption());
    }).bind(this);

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

    public gotoDetail(recordedId: apid.RecordedId): void {
        Util.move(this.$router, { path: `/recorded/detail/${recordedId.toString(10)}` });
    }

    public async stopEncode(recordedId: apid.RecordedId): Promise<void> {
        try {
            await this.recordedState.stopEncode(recordedId);
            this.snackbarState.open({
                color: 'success',
                text: 'エンコード停止',
            });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'エンコード停止に失敗',
            });
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.recordedState.clearData();
        this.$nextTick(async () => {
            await this.recordedState.fetchData(this.createFetchDataOption()).catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '録画データ取得に失敗',
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
    private createFetchDataOption(): apid.GetRecordedOption {
        if (this.settingValue === null) {
            throw new Error('SettingValueIsNull');
        }

        const type = this.$route.query.type;

        return {
            isHalfWidth: this.settingValue.isRecordedHalfWidthDisplayed,
            offset: (Util.getPageNum(this.$route) - 1) * this.settingValue.reservesLength,
            limit: this.settingValue.recordedLength,
        };
    }
}
</script>
