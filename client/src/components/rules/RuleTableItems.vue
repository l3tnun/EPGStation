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
                    <tr v-for="item in items" v-bind:key="item.display.id" v-bind:class="{ 'selected-color': item.isSelected === true }" v-on:click="selectItem(item)">
                        <td class="toggle">
                            <v-switch v-if="isEditMode === false" v-model="item.display.isEnable" hide-details dense value v-on:change="changeState(item)"></v-switch>
                        </td>
                        <td>{{ item.display.keyword }}</td>
                        <td>{{ item.display.ignoreKeyword }}</td>
                        <td>{{ item.display.channels }}</td>
                        <td>{{ item.display.genres }}</td>
                        <td class="reserve-cnt reserve-cnt-body">{{ item.display.reservationsCnt }}</td>
                        <td class="menu">
                            <RuleItemMenu v-if="isEditMode === false" :ruleItem="item"></RuleItemMenu>
                        </td>
                    </tr>
                </tbody>
            </template>
        </v-simple-table>
    </v-card>
</template>

<script lang="ts">
import RuleItemMenu from '@/components/rules/RuleItemMenu.vue';
import { RuleStateData, RuleStateDisplayData } from '@/model/state/rule/IRuleState';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({
    components: {
        RuleItemMenu,
    },
})
export default class RuleTableItem extends Vue {
    @Prop({ required: true })
    public items!: RuleStateData[];

    @Prop({ required: true })
    public isEditMode!: boolean;

    /**
     * ルールの有効、無効を変える
     */
    public changeState(item: RuleStateData): void {
        this.$emit('changeState', item);
    }

    /**
     * item 選択
     */
    public selectItem(item: RuleStateData): void {
        if (this.isEditMode === false) {
            return;
        }

        this.$emit('selected', item.display.id);
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

tbody
    tr
        cursor: default
</style>

<style lang="sass">
.rule-table
    table
        width: 100%
        table-layout: fixed
</style>
