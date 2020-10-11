<template>
    <v-dialog v-if="isRemove === false" v-model="dialogModel" max-width="300" scrollable>
        <v-card>
            <v-card-text class="pa-4">
                <div class="text--primary">{{ name }} を削除しますか?</div>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="primary" text v-on:click="dialogModel = false">キャンセル</v-btn>
                <v-btn color="primary" text v-on:click="deleteReserve">削除</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import IReservesApiModel from '@/model/api/reserves/IReservesApiModel';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class ReserveDeleteDialog extends Vue {
    @Prop({ required: true })
    public reserveItem!: apid.ReserveItem;

    @Prop({ required: true })
    public isOpen!: boolean;

    public isRemove: boolean = false;

    private reserveApiModel = container.get<IReservesApiModel>('IReservesApiModel');
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

    // 番組名
    get name(): string {
        return typeof this.reserveItem.name === 'undefined' ? `予約id: ${this.reserveItem.id.toString(10)}` : this.reserveItem.name;
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
     * 予約削除
     */
    public async deleteReserve(): Promise<void> {
        this.dialogModel = false;

        try {
            await this.reserveApiModel.cancel(this.reserveItem.id);
            this.snackbarState.open({
                color: 'success',
                text: `${this.name} を削除`,
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: `${this.name} を削除に失敗`,
            });
            console.error(err);
        }
    }
}
</script>
