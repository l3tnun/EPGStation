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
        <TitleBar v-else title="録画中">
            <template v-slot:menu>
                <v-btn icon v-on:click="onEdit">
                    <v-icon>mdi-pencil</v-icon>
                </v-btn>
            </template>
        </TitleBar>
        <transition name="page">
            <div v-if="recordingState.getRecorded().length > 0" ref="appContent" class="app-content pa-2">
                <RecordedItems
                    :recorded="recordingState.getRecorded()"
                    :isRecording="true"
                    :isTableMode="true"
                    :isEditMode.sync="isEditMode"
                    :isShowDropInfo="false"
                    v-on:detail="gotoDetail"
                    v-on:selected="selectItem"
                ></RecordedItems>
                <Pagination :total="recordingState.getTotal()" :pageSize="settingValue.recordingLength"></Pagination>
                <div style="visibility: hidden">dummy</div>
            </div>
        </transition>
        <RecordedMultipleDeletionDialog
            v-if="isEditMode === true"
            :isOpen.sync="isOpenMultiplueDeletionDialog"
            :total="recordingState.getSelectedCnt()"
            :disableOption="true"
            v-on:delete="onExecuteMultiplueDeletion"
        ></RecordedMultipleDeletionDialog>
    </v-content>
</template>

<script lang="ts">
import Pagination from '@/components/pagination/Pagination.vue';
import RecordedItems from '@/components/recorded/RecordedItems.vue';
import RecordedMultipleDeletionDialog from '@/components/recorded/RecordedMultipleDeletionDialog.vue';
import EditTitleBar from '@/components/titleBar/EditTitleBar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import { RecordedDisplayData } from '@/model/state/recorded/IRecordedUtil';
import IRecordingState from '@/model/state/recording/IRecordingState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';
import { Component, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';
import * as apid from '../../../api';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
        EditTitleBar,
        RecordedItems,
        Pagination,
        RecordedMultipleDeletionDialog,
    },
})
export default class Recording extends Vue {
    public isEditMode: boolean = false;
    public isOpenMultiplueDeletionDialog: boolean = false;

    private recordingState: IRecordingState = container.get<IRecordingState>('IRecordingState');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private settingValue: ISettingValue | null = null;
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async (): Promise<void> => {
        await this.recordingState.fetchData(this.createFetchDataOption());
    }).bind(this);

    get selectedTitle(): string {
        return `${this.recordingState.getSelectedCnt()} 件選択`;
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

    public gotoDetail(recordedId: apid.RecordedId): void {
        Util.move(this.$router, { path: `/recorded/detail/${recordedId.toString(10)}` });
    }

    public onEdit(): void {
        this.isEditMode = true;
    }

    public onFinishEdit(): void {
        this.recordingState.clearSelect();
    }

    public onSelectAll(): void {
        this.recordingState.selectAll();
    }

    public selectItem(recordedId: apid.RecordedId): void {
        this.recordingState.select(recordedId);
    }

    public onMultiplueDeletion(): void {
        this.isOpenMultiplueDeletionDialog = true;
    }

    public async onExecuteMultiplueDeletion(): Promise<void> {
        this.isOpenMultiplueDeletionDialog = false;
        this.isEditMode = false;
        try {
            await this.recordingState.multiplueDeletion();
            this.snackbarState.open({
                color: 'success',
                text: '選択した番組を削除しました。',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: '一部番組の削除に失敗しました。',
            });
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.recordingState.clearData();

        this.$nextTick(async () => {
            await this.recordingState.fetchData(this.createFetchDataOption()).catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '録画データ取得に失敗',
                });
                console.error(err);
            });

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    /**
     * 番組データ取得時のオプションを生成する
     * @return GetReserveOption
     */
    private createFetchDataOption(): apid.GetRecordedOption {
        if (this.settingValue === null) {
            throw new Error('SettingValueIsNull');
        }

        return {
            isHalfWidth: this.settingValue.isHalfWidthDisplayed,
            offset: (Util.getPageNum(this.$route) - 1) * this.settingValue.recordingLength,
            limit: this.settingValue.recordingLength,
        };
    }
}
</script>
