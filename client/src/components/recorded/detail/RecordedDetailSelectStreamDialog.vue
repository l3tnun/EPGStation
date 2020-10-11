<template>
    <div class="recorded-detail-select-stream">
        <v-dialog v-if="isRemove === false" v-model="dialogState.isOpen" max-width="400" scrollable>
            <v-card v-if="dialogState.title !== null">
                <div class="pa-4 pb-0">
                    <div>{{ dialogState.title }}</div>
                    <div class="d-flex">
                        <v-select
                            :items="dialogState.streamTypeItems"
                            v-model="dialogState.selectedStreamType"
                            v-on:change="updateModeItems"
                            style="max-width: 120px"
                            :menu-props="{ auto: true }"
                        ></v-select>
                        <v-select
                            v-if="isHiddenStreamMode === false"
                            :items="dialogState.streamModeItems"
                            v-model="dialogState.selectedStreamMode"
                            :menu-props="{ auto: true }"
                        ></v-select>
                    </div>
                </div>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn color="primary" text v-on:click="cancel">キャンセル</v-btn>
                    <v-btn color="primary" text v-on:click="view">視聴</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IRecordedDetailSelectStreamState from '@/model/state/recorded/detail/IRecordedDetailSelectStreamState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../../api';

@Component({})
export default class RecordedDetailSelectStreamDialog extends Vue {
    public dialogState: IRecordedDetailSelectStreamState = container.get<IRecordedDetailSelectStreamState>('IRecordedDetailSelectStreamState');
    public isRemove: boolean = false;
    // ストリーム視聴設定セレクタ再描画用
    public isHiddenStreamMode: boolean = false;

    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public beforeDestroy(): void {
        this.dialogState.close();
    }

    public updateModeItems(): void {
        this.dialogState.updateModeItems();

        // 再描画
        this.isHiddenStreamMode = true;
        this.$nextTick(() => {
            this.isHiddenStreamMode = false;
        });
    }

    public cancel(): void {
        this.dialogState.isOpen = false;
    }

    public async view(): Promise<void> {
        if (typeof this.dialogState.selectedStreamType === 'undefined' || typeof this.dialogState.selectedStreamMode === 'undefined') {
            this.snackbarState.open({
                color: 'error',
                text: '配信設定が正しく入力されていません',
            });

            return;
        }

        const recordedId = this.dialogState.getRecordedId();
        if (recordedId === null) {
            this.snackbarState.open({
                color: 'error',
                text: '番組 ID が不正です',
            });

            return;
        }

        await Util.move(this.$router, {
            path: `/recorded/streaming/${this.dialogState.getVideoFileId()}`,
            query: {
                recordedId: recordedId.toString(),
                streamingType: this.dialogState.selectedStreamType.toLowerCase(),
                mode: this.dialogState.selectedStreamMode.toString(10),
            },
        });
    }

    /**
     * dialog の表示状態が変更されたときに呼ばれる
     */
    @Watch('dialogState.isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === false && oldState === true) {
            // close
            this.$nextTick(async () => {
                await Util.sleep(100);
                this.isRemove = true;
                this.$nextTick(() => {
                    this.isRemove = false;
                    this.dialogState.close();
                });
            });
        }
    }
}
</script>
