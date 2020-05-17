<template>
    <div class="rules-wrap mb-1">
        <RuleTableItems v-if="elementWidth >= 780 - 24" :items="items" v-on:changeState="changeState"></RuleTableItems>
        <RuleListItens v-else :items="items" v-on:changeState="changeState"></RuleListItens>
    </div>
</template>

<script lang="ts">
import RuleListItens from '@/components/rules/RuleListItens.vue';
import RuleTableItems from '@/components/rules/RuleTableItems.vue';
import IRuleApiModel from '@/model/api/rule/IRuleApiModel';
import container from '@/model/ModelContainer';
import { RuleStateData, RuleStateDisplayData } from '@/model/state/rule/IRuleState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import ResizeObserver from 'resize-observer-polyfill';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({
    components: {
        RuleTableItems,
        RuleListItens,
    },
})
export default class RuleItems extends Vue {
    @Prop({ required: true })
    public rules!: RuleStateData[];

    public elementWidth: number = 0;

    private ruleApiModel = container.get<IRuleApiModel>('IRuleApiModel');
    private snackbarState = container.get<ISnackbarState>('ISnackbarState');

    private resizeObserver: ResizeObserver | null = null;

    get items(): any[] {
        return this.rules.map(r => {
            return r.display;
        });
    }

    public mounted(): void {
        this.resizeObserver = new ResizeObserver(() => {
            this.elementWidth = this.$el.clientWidth;
        });
        this.resizeObserver!.observe(this.$el);

        this.$nextTick(() => {
            this.elementWidth = this.$el.clientWidth;
        });
    }

    public beforeDestroy(): void {
        // disconnect resize observer
        if (this.resizeObserver !== null) {
            this.resizeObserver.disconnect();
        }
    }

    /**
     * ルールの有効、無効を変える
     */
    public changeState(item: RuleStateDisplayData): void {
        try {
            if (item.isEnable === true) {
                this.ruleApiModel.enable(item.id);
                this.snackbarState.open({
                    color: 'success',
                    text: `有効化: ${item.keyword}`,
                });
            } else {
                this.ruleApiModel.disable(item.id);
                this.snackbarState.open({
                    color: 'success',
                    text: `無効化: ${item.keyword}`,
                });
            }
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: `ルールの${item.isEnable ? '有効化' : '無効化'}に失敗`,
            });

            item.isEnable = !item.isEnable;

            console.error('change rule state error');
            console.error(err);
        }
    }
}
</script>
