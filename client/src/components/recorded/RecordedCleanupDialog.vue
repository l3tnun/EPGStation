<template>
    <v-dialog v-if="isRemove === false" v-model="dialogModel" :persistent="isClearing" max-width="300" scrollable>
        <v-card v-if="isClearing === false">
            <v-card-text class="pa-4">
                <div class="text--primary">データベースに登録されていないファイルおよびディレクトリを削除します。実行しますか?</div>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="primary" text v-on:click="dialogModel = false">キャンセル</v-btn>
                <v-btn color="primary" text v-on:click="execute">実行</v-btn>
            </v-card-actions>
        </v-card>
        <v-card v-else>
            <v-card-text class="pa-4">
                <h3>クリーンアップ中</h3>
                <v-progress-linear class="my-5" indeterminate rounded height="6"></v-progress-linear>
            </v-card-text>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import IRecordedApiModel from '@/model/api/recorded/IRecordedApiModel';
import IThumbnailApiModel from '@/model/api/thumbnail/IThumbnailApiModel';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class RecordedCleanupDialog extends Vue {
    @Prop({ required: true })
    public isOpen!: boolean;

    public isRemove: boolean = false;
    public isClearing: boolean = false;

    private recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');
    private thumbnailApiModel = container.get<IThumbnailApiModel>('IThumbnailApiModel');
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

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === false && oldState === true) {
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

    public async execute(): Promise<void> {
        this.isClearing = true;

        let isSuccess = false;
        const now = new Date().getTime();
        try {
            await this.recordedApiModel.cleanup();
            await this.thumbnailApiModel.cleanup();
            isSuccess = true;
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'クリーンアップに失敗',
            });
        }

        // 1秒以上はプログレスバーを表示させる
        const diff = new Date().getTime() - now;
        if (diff < 1000) {
            await Util.sleep(1000 - diff);
        }

        this.dialogModel = false;

        if (isSuccess === true) {
            this.snackbarState.open({
                color: 'success',
                text: 'クリーンアップ完了',
            });
        }

        await Util.sleep(300);
        this.isClearing = false;
    }
}
</script>
