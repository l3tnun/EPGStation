<template>
    <v-dialog v-if="isRemove === false" v-model="dialogModel" max-width="300" scrollable>
        <v-card>
            <v-card-text class="pa-4">
                <div class="text--primary">{{ ruleItem.keyword }} を削除しますか?</div>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="primary" text v-on:click="dialogModel = false">キャンセル</v-btn>
                <v-btn color="primary" text v-on:click="deleteRule">削除</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import IRuleApiModel from '@/model/api/rule/IRuleApiModel';
import container from '@/model/ModelContainer';
import { RuleStateDisplayData } from '@/model/state/rule/IRuleState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class RuleDeleteDialog extends Vue {
    @Prop({ required: true })
    public ruleItem!: RuleStateDisplayData;

    @Prop({ required: true })
    public isOpen!: boolean;

    public isRemove: boolean = false;

    private ruleApiModel = container.get<IRuleApiModel>('IRuleApiModel');
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
     * 録画削除
     */
    public async deleteRule(): Promise<void> {
        this.dialogModel = false;

        try {
            await this.ruleApiModel.delete(this.ruleItem.id);
            this.snackbarState.open({
                color: 'success',
                text: `${this.ruleItem.keyword} を削除`,
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: `${this.ruleItem.keyword} を削除に失敗`,
            });
            console.error(err);
        }
    }
}
</script>
