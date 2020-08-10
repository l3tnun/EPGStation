<template>
    <v-dialog v-if="isRemove === false" v-model="dialogModel" max-width="600" scrollable>
        <v-card>
            <div class="subtitle-2 px-4 pt-4 pb-2">{{ name }}</div>
            <v-card-text class="px-4 pb-4">
                <div class="overflow-auto">
                    <pre class="body-2">{{ content }}</pre>
                </div>
            </v-card-text>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IDropLogDialogState from '@/model/state/dropLog/IDropLogDialogState';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';

@Component({})
export default class DropLogDialog extends Vue {
    @Prop({ required: true })
    public isOpen!: boolean;

    private dropLogState: IDropLogDialogState = container.get<IDropLogDialogState>('IDropLogDialogState');

    public isRemove: boolean = false;

    get name(): string {
        return this.dropLogState.getName();
    }

    get content(): string {
        const content = this.dropLogState.getDropLog();

        return content === null ? 'ログファイルがありません' : content;
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
