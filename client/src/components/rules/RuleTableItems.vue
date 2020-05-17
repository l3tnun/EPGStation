<template>
    <v-card class="mx-auto rule-table">
        <v-simple-table>
            <template v-slot:default>
                <thead>
                    <tr>
                        <td class="text-left toggle"></td>
                        <td class="text-left">キーワード</td>
                        <td class="text-left">除外キーワード</td>
                        <td class="text-left">放送局</td>
                        <td class="text-left">ジャンル</td>
                        <td class="text-left reserve-cnt">予約数</td>
                        <td class="text-left menu"></td>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="item in items" v-bind:key="item.id">
                        <td class="toggle">
                            <v-switch
                                v-model="item.isEnable"
                                hide-details
                                dense
                                value
                                v-on:change="changeState(item)"
                            ></v-switch>
                        </td>
                        <td>{{ item.keyword }}</td>
                        <td>{{ item.ignoreKeyword }}</td>
                        <td>{{ item.channels }}</td>
                        <td>{{ item.genres }}</td>
                        <td class="reserve-cnt reserve-cnt-body">{{ item.reservationsCnt }}</td>
                        <td class="menu"><RuleItemMenu :ruleItem="item"></RuleItemMenu></td>
                    </tr>
                </tbody>
            </template>
        </v-simple-table>
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
export default class RuleTableItem extends Vue {
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
    width: 82px
.menu
    width: 68px
.reserve-cnt
    width: 80px
.reserve-cnt-body
    text-align: center
</style>

<style lang="sass">
.rule-table
    table
        width: 100%
        table-layout: fixed
</style>
