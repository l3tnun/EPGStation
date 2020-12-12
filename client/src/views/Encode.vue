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
        <TitleBar v-else title="エンコード">
            <template v-slot:menu>
                <v-btn icon v-on:click="onEdit">
                    <v-icon>mdi-pencil</v-icon>
                </v-btn>
            </template>
        </TitleBar>
        <transition name="page">
            <div ref="appContent" class="mx-auto app-content pa-2">
                <div v-if="encodeState.getEncodeInfo().runningItems.length > 0">
                    <div class="title">エンコード中</div>
                    <EncodeItems :items="encodeState.getEncodeInfo().runningItems" :isEditMode.sync="isEditMode" v-on:selected="selectItem"></EncodeItems>
                </div>
                <div v-if="encodeState.getEncodeInfo().waitItems.length > 0">
                    <div class="title pt-2">待機中</div>
                    <EncodeItems :items="encodeState.getEncodeInfo().waitItems" :isEditMode.sync="isEditMode" v-on:selected="selectItem"></EncodeItems>
                </div>
                <div style="visibility: hidden">dummy</div>
            </div>
        </transition>
        <EncodeMultipleDeletionDialog
            :isOpen.sync="isOpenMultiplueDeletionDialog"
            :total="encodeState.getSelectedCnt()"
            v-on:delete="onExecuteMultiplueDeletion"
        ></EncodeMultipleDeletionDialog>
    </v-content>
</template>

<script lang="ts">
import EncodeItems from '@/components/encode/EncodeItems.vue';
import EncodeMultipleDeletionDialog from '@/components/encode/EncodeMultipleDeletionDialog.vue';
import EditTitleBar from '@/components/titleBar/EditTitleBar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IEncodeState from '@/model/state/encode/IEncodeState';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import { Component, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../api';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        EditTitleBar,
        TitleBar,
        EncodeItems,
        EncodeMultipleDeletionDialog,
    },
})
export default class Encode extends Vue {
    public isEditMode: boolean = false;
    public isOpenMultiplueDeletionDialog: boolean = false;

    private encodeState: IEncodeState = container.get<IEncodeState>('IEncodeState');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private settingValue: ISettingValue | null = null;
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async (): Promise<void> => {
        await this.encodeState.fetchData(this.isHalfWidth());
    }).bind(this);

    get selectedTitle(): string {
        return `${this.encodeState.getSelectedCnt()} 件選択`;
    }

    public created(): void {
        this.settingValue = this.setting.getSavedValue();

        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
        this.socketIoModel.onUpdateEncodeState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
        this.socketIoModel.offUpdateEncodeState(this.onUpdateStatusCallback);
    }

    public onEdit(): void {
        this.isEditMode = true;
    }

    public onFinishEdit(): void {
        this.encodeState.clearSelect();
    }

    public onSelectAll(): void {
        this.encodeState.selectAll();
    }

    public selectItem(ruleId: apid.ReserveId): void {
        this.encodeState.select(ruleId);
    }

    public onMultiplueDeletion(): void {
        this.isOpenMultiplueDeletionDialog = true;
    }

    public async onExecuteMultiplueDeletion(): Promise<void> {
        this.isOpenMultiplueDeletionDialog = false;
        this.isEditMode = false;
        try {
            await this.encodeState.multiplueDeletion();
            this.snackbarState.open({
                color: 'success',
                text: '選択したエンコードをキャンセルしました。',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: '一部エンコードのキャンセルに失敗しました。',
            });
        }
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
        return this.settingValue === null ? true : this.settingValue.isHalfWidthDisplayed;
    }
}
</script>

<style lang="sass" scoped>
.app-content
    max-width: 800px
</style>
