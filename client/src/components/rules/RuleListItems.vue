<template>
    <v-card class="mx-auto" max-width="800">
        <v-list>
            <v-list-item v-for="item in items" v-bind:key="item.display.id" v-bind:class="{ 'selected-color': item.isSelected === true }">
                <v-list-item-content>
                    <div class="pl-2 d-flex flex-row flex-wrap align-center" v-on:click="selectItem(item)">
                        <v-switch v-if="isEditMode === false" v-model="item.display.isEnable" hide-details dense value v-on:change="changeState(item)" class="toggle"></v-switch>
                        <div class="keyword">
                            <!--
                            {{ item.keyword }}
                            -->
                            <v-list-item-title class="subtitle-1">{{ item.display.keyword }}</v-list-item-title>
                        </div>
                        <div class="menu d-flex align-center">
                            <span class="mx-2 grey--text text--lighten-1">{{ item.display.reservationsCnt }}</span>
                            <RuleItemMenu v-if="isEditMode === false" :ruleItem="item"></RuleItemMenu>
                        </div>
                    </div>
                </v-list-item-content>
            </v-list-item>
        </v-list>
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
export default class RuleListItems extends Vue {
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

.selected-color
    .v-list-item__title
        color: white !important
</style>
