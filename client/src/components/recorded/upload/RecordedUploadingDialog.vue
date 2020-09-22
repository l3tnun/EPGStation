<template>
    <v-dialog v-if="isRemove === false" v-model="dialogModel" persistent max-width="300" scrollable>
        <v-card>
            <v-card-text class="pa-4">
                <h3>アップロード中</h3>
                <v-progress-linear class="my-5" indeterminate rounded height="6"></v-progress-linear>
            </v-card-text>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../../api';

@Component({})
export default class RecordedUploadingDialog extends Vue {
    @Prop({ required: true })
    public isOpen!: boolean;

    public isRemove: boolean = false;

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
}
</script>
