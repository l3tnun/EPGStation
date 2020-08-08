<template>
    <v-dialog v-if="isRemove === false" v-model="dialogModel" max-width="300" scrollable>
        <v-card>
            <div class="pa-4 pb-0">
                <div class="text--primary">[{{ this.item.mode }}] {{ this.item.recorded.name }} を停止しますか?</div>
            </div>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="error" text v-on:click="dialogModel = false">キャンセル</v-btn>
                <v-btn color="primary" text v-on:click="cancel">停止</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import IEncodeApiModel from '@/model/api/encode/IEncodeApiModel';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class EncodeCancelDialog extends Vue {
    @Prop({ required: true })
    public item!: apid.EncodeProgramItem;

    @Prop({ required: true })
    public isOpen!: boolean;

    public isRemove: boolean = false;

    private encodeApiModel = container.get<IEncodeApiModel>('IEncodeApiModel');
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

    /**
     * エンコードキャンセル
     */
    public async cancel(): Promise<void> {
        try {
            await this.encodeApiModel.cancel(this.item.id);
            this.dialogModel = false;
            this.$nextTick(() => {
                this.snackbarState.open({
                    color: 'success',
                    text: `[${this.item.mode}] ${this.item.recorded.name} を停止しました`,
                });
            });
        } catch (err) {
            this.dialogModel = false;
            this.$nextTick(() => {
                this.snackbarState.open({
                    color: 'error',
                    text: `[${this.item.mode}] ${this.item.recorded.name} の停止に失敗`,
                });
            });
        }
    }
}
</script>
