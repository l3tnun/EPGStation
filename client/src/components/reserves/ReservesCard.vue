<template>
    <div v-bind:class="{ 'needs-decoration': !!needsDecoration }">
        <v-row dense>
            <v-col v-for="reserve in reserves" v-bind:key="reserve.id" cols="12">
                <v-card class="mx-auto" v-bind:class="getClass(reserve)" max-width="800">
                    <v-list-item three-line>
                        <v-list-item-content>
                            <div class="d-flex">
                                <div class="subtitle-1 font-weight-black">{{ reserve.display.name }}</div>
                                <v-spacer></v-spacer>
                                <ReserveMenu
                                    :reserveItem="reserve.reserveItem"
                                    :disableEdit="disableEdit"
                                ></ReserveMenu>
                            </div>
                            <div class="subtitle-2 font-weight-light">{{ reserve.display.channelName }}</div>
                            <div class="caption font-weight-light mb-2">
                                {{ reserve.display.day }}({{ reserve.display.dow }}) {{ reserve.display.startTime }} ~
                                {{ reserve.display.endTime }} ({{ reserve.display.duration }}分)
                            </div>
                            <div class="body-2 grey--text text--darken-2">{{ reserve.display.description }}</div>
                        </v-list-item-content>
                    </v-list-item>
                </v-card>
            </v-col>
        </v-row>
    </div>
</template>

<script lang="ts">
import ReserveMenu from '@/components/reserves/ReserveMenu.vue';
import { ReserveStateData } from '@/model/state/reserve/IReserveStateUtil';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({
    components: {
        ReserveMenu,
    },
})
export default class ReservesCard extends Vue {
    @Prop({
        required: true,
    })
    public reserves!: ReserveStateData[];

    @Prop({})
    public needsDecoration: boolean | undefined;

    @Prop({})
    public disableEdit: boolean | undefined;

    public getClass(reserve: ReserveStateData): any {
        if (reserve.reserveItem.isSkip === true) {
            return {
                skip: true,
            };
        } else if (reserve.reserveItem.isConflict === true) {
            return {
                conflict: true,
            };
        } else if (reserve.reserveItem.isOverlap === true) {
            return {
                overlap: true,
            };
        } else {
            return {
                reserve: true,
            };
        }
    }
}
</script>

<style lang="sass" scoped>
.needs-decoration
    .reserve
        border: 4px solid red
    .conflict
        background-color: #fffd6b
        border: 4px solid red
        border-style: dashed
    .skip
        background-color: #aaa
    .overlap
        text-decoration: line-through
        background-color: #aaa
        color: black
</style>
