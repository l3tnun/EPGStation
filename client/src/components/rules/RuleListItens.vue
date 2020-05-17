<template>
    <v-card class="mx-auto" max-width="800">
        <v-list>
            <v-list-item v-for="item in items" v-bind:key="item.id">
                <v-list-item-content>
                    <div class="pl-2 d-flex flex-row flex-wrap align-center">
                        <v-switch
                            v-model="item.isEnable"
                            hide-details
                            dense
                            value
                            v-on:change="changeState(item)"
                            class="toggle"
                        ></v-switch>
                        <div class="keyword">
                            <!--
                            {{ item.keyword }}
                            -->
                            <v-list-item-title class="subtitle-1">{{ item.keyword }}</v-list-item-title>
                        </div>
                        <div class="menu d-flex align-center">
                            <span class="mx-2 grey--text text--lighten-1">{{ item.reservationsCnt }}</span>
                            <RuleItemMenu :ruleItem="item"></RuleItemMenu>
                        </div>
                    </div>
                </v-list-item-content>
            </v-list-item>
        </v-list>
    </v-card>
</template>

<script lang="ts">
import RuleItemMenu from '@/components/rules/RuleItemMenu.vue';
import { RuleStateDisplayData } from '@/model/state/rule/IRuleState';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({
    components: {
        RuleItemMenu,
    },
})
export default class RuleListItens extends Vue {
    @Prop({ required: true })
    public items!: RuleStateDisplayData[];

    /**
     * ルールの有効、無効を変える
     */
    public changeState(item: RuleStateDisplayData): void {
        this.$emit('changeState', item);
    }
}
</script>

<style lang="sass" scoped>
.toggle
    position: absolute
    left: 0
    padding-left: 16px
.keyword
    padding-left: 42px
    padding-right: 77px
    .subtitle-1
        white-space: normal !important
        word-break: break-all
.menu
    position: absolute
    right: 0
    padding-right: 16px
</style>
