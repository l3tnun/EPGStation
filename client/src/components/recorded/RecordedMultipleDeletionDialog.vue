<template>
    <v-dialog v-if="isRemove === false" v-model="dialogModel" max-width="300" scrollable>
        <v-card class="recorded-multiple-deletion-dialog">
            <v-card-text class="pa-4 pb-0">
                <div>選択した {{ total }} 件の番組を削除しますか。</div>
                <div v-if="!!disableOption === false">
                    <v-select :items="optionItems" v-model="deleteOption" :menu-props="{ auto: true }"></v-select>
                </div>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="primary" text v-on:click="dialogModel = false">キャンセル</v-btn>
                <v-btn color="primary" text v-on:click="deleteRecorded">削除</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import { MultipleDeletionOption } from '@/model/state/recorded/IRecordedState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';

interface SelectItem {
    text: string;
    value: MultipleDeletionOption;
}

@Component({})
export default class RecordedMultipleDeletionDialog extends Vue {
    @Prop({ required: true })
    public isOpen!: boolean;

    @Prop({ required: true })
    public total!: number;

    @Prop({ required: false })
    public disableOption: boolean | undefined;

    public isRemove: boolean = false;

    public optionItems: SelectItem[] = [];
    public deleteOption: MultipleDeletionOption = 'All';

    private snackbarState = container.get<ISnackbarState>('ISnackbarState');

    constructor() {
        super();

        this.optionItems.push({
            text: '全て',
            value: 'All',
        });
        this.optionItems.push({
            text: 'オリジナルファイルだけ',
            value: 'OnlyOriginalFile',
        });
        this.optionItems.push({
            text: 'エンコードファイルだけ',
            value: 'OnlyEncodedFile',
        });
    }

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

    public deleteRecorded(): void {
        this.$emit('delete', this.deleteOption);
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && !!oldState === false) {
            if (this.total === 0) {
                this.dialogModel = false;
                this.snackbarState.open({
                    color: 'error',
                    text: '番組を選択してください。',
                });
            }
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
}
</script>

<style lang="sass">
.recorded-multiple-deletion-dialog
    .v-input--switch
        margin-right: 4px
        margin-top: 0 !important
        padding-top: 0 !important
    .v-input__slot
        margin-bottom: 0 !important
    .v-messages
        display: none
</style>
