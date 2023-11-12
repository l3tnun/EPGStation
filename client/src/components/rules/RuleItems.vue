<template>
    <div class="rules-wrap mb-1">
        <RuleTableItems v-if="elementWidth >= 780 - 24" :items="rules" :isEditMode.sync="isEditMode" v-on:changeState="changeState" v-on:selected="selected"></RuleTableItems>
        <RuleListItems v-else :items="rules" :isEditMode.sync="isEditMode" v-on:changeState="changeState" v-on:selected="selected"></RuleListItems>
    </div>
</template>

<script lang="ts">
import RuleListItems from '@/components/rules/RuleListItems.vue';
import RuleTableItems from '@/components/rules/RuleTableItems.vue';
import IRuleApiModel from '@/model/api/rule/IRuleApiModel';
import container from '@/model/ModelContainer';
import { RuleStateData } from '@/model/state/rule/IRuleState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import ResizeObserver from 'resize-observer-polyfill';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({
    components: {
        RuleTableItems,
        RuleListItems,
    },
})
export default class RuleItems extends Vue {
    @Prop({ required: true })
    public rules!: RuleStateData[];

    @Prop({ required: true })
    public isEditMode!: boolean;

    public elementWidth: number = 0;

    private ruleApiModel = container.get<IRuleApiModel>('IRuleApiModel');
    private snackbarState = container.get<ISnackbarState>('ISnackbarState');

    private resizeObserver: ResizeObserver | null = null;

    public mounted(): void {
        this.resizeObserver = new ResizeObserver(() => {
            this.elementWidth = this.$el.clientWidth;
        });
        if (this.resizeObserver !== null) {
            this.resizeObserver.observe(this.$el);
        }

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
    public changeState(item: RuleStateData): void {
        try {
            if (item.display.isEnable === true) {
                this.ruleApiModel.enable(item.display.id);
                this.snackbarState.open({
                    color: 'success',
                    text: `有効化: ${item.display.keyword}`,
                });
            } else {
                this.ruleApiModel.disable(item.display.id);
                this.snackbarState.open({
                    color: 'success',
                    text: `無効化: ${item.display.keyword}`,
                });
            }
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: `ルールの${item.display.isEnable ? '有効化' : '無効化'}に失敗`,
            });

            item.display.isEnable = !item.display.isEnable;

            console.error('change rule state error');
            console.error(err);
        }
    }

    /**
     * ルールが選択された
     * @param ruleId: apid.RuleId
     */
    public selected(ruleId: apid.RuleId): void {
        this.$emit('selected', ruleId);
    }
}
</script>
