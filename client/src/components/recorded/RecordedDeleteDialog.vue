<template>
    <v-dialog v-if="isRemove === false" v-model="dialogModel" max-width="300" scrollable>
        <v-card>
            <div class="pa-4 pb-0">
                <div class="text--primary">{{ recordedItem.name }} を削除しますか?</div>
                <div class="checkboxs py-2">
                    <v-checkbox v-for="v in videoFiles" v-bind:key="v.id" v-model="v.isDelete" :label="v.name" class="my-0"></v-checkbox>
                </div>
            </div>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="primary" text v-on:click="dialogModel = false">キャンセル</v-btn>
                <v-btn color="primary" text v-on:click="deleteRecorded">削除</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

interface VideoFileInfo {
    id: apid.VideoFileId;
    name: string;
    isDelete: boolean;
}

@Component({})
export default class RecordedDeleteDialog extends Vue {
    @Prop({ required: true })
    public recordedItem!: apid.RecordedItem;

    @Prop({ required: true })
    public isOpen!: boolean;

    @Prop({ required: false })
    public isDelaySnackbarViewNum: number | undefined;

    public isRemove: boolean = false;
    public videoFiles: VideoFileInfo[] = [];

    private recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    private videApiModel = container.get<IVideoApiModel>('IVideoApiModel');
    private snackbarState = container.get<ISnackbarState>('ISnackbarState');

    /**
     * Prop で受け取った isOpen を直接は書き換えられないので
     * getter, setter を用意する
     */
    get dialogModel(): boolean {
        return this.isOpen;
    }
    set dialogModel(value: boolean) {
        this.$emit('update:isOpen', value);
    }

    private init(): void {
        if (typeof this.recordedItem.videoFiles === 'undefined') {
            return;
        }

        this.videoFiles = this.recordedItem.videoFiles.map(v => {
            return {
                id: v.id,
                name: `${v.name} (${Util.getFileSizeStr(v.size)})`,
                isDelete: true,
            };
        });
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && !!oldState === false) {
            this.init();
        } else if (newState === false && oldState === true) {
            // close
            this.$nextTick(async () => {
                await Util.sleep(100);
                // dialog close アニメーションが終わったら要素を削除する
                this.isRemove = true;
                this.$nextTick(() => {
                    this.isRemove = false;
                });
            });
        }
    }

    /**
     * 録画削除
     */
    public async deleteRecorded(): Promise<void> {
        this.dialogModel = false;

        try {
            const needsPageback = await this.delete();
            this.$nextTick(async () => {
                if (typeof this.isDelaySnackbarViewNum !== 'undefined') {
                    await Util.sleep(this.isDelaySnackbarViewNum);
                }
                this.snackbarState.open({
                    color: 'success',
                    text: `${this.recordedItem.name} を削除`,
                });
            });

            this.$emit('deleteSiccessful', needsPageback);
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: `${this.recordedItem.name} を削除に失敗`,
            });
            console.error(err);
        }
    }

    /**
     * video 削除処理
     * @return Promise<boolean> 全件削除の場合は true を返す
     */
    private async delete(): Promise<boolean> {
        let isAllDelete = true;
        for (const v of this.videoFiles) {
            if (v.isDelete === false) {
                isAllDelete = false;
                break;
            }
        }

        // 全件削除
        if (isAllDelete === true) {
            await this.recordedApiModel.delete(this.recordedItem.id);

            return true;
        }

        // 個別削除
        let isError = false;
        for (const v of this.videoFiles) {
            if (v.isDelete === true) {
                await this.videApiModel.delete(v.id).catch(err => {
                    console.error(`delete video failed: ${v.id}`);
                    console.error(err);
                    isError = true;
                });
            }
        }

        if (isError !== false) {
            throw new Error('DeleteVideoFailed');
        }

        return false;
    }
}
</script>

<style lang="sass">
.checkboxs
    .v-input__control
        .v-input__slot
            margin: 0 !important
        .v-messages
            display: none
</style>
