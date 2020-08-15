<template>
    <div v-bind:class="{ 'needs-decoration': !!needsDecoration }">
        <v-card
            v-for="reserve in reserves"
            v-bind:key="reserve.id"
            v-bind:class="getClass(reserve)"
            class="mx-auto"
            max-width="800px"
            :flat="!!flat"
        >
            <v-list-item class="px-3" three-line>
                <v-list-item-content>
                    <div class="d-flex">
                        <div class="subtitle-1 font-weight-black">{{ reserve.display.name }}</div>
                        <v-spacer></v-spacer>
                        <ReserveMenu :reserveItem="reserve.reserveItem" :disableEdit="disableEdit"></ReserveMenu>
                    </div>
                    <div class="subtitle-2 font-weight-light">{{ reserve.display.channelName }}</div>
                    <div class="caption font-weight-light mb-2">
                        {{ reserve.display.day }}({{ reserve.display.dow }}) {{ reserve.display.startTime }} ~
                        {{ reserve.display.endTime }} ({{ reserve.display.duration }}分)
                    </div>
                    <div class="body-2 font-weight-light">{{ reserve.display.description }}</div>
                </v-list-item-content>
            </v-list-item>
        </v-card>
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

    @Prop({})
    public flat: boolean | undefined;

    public getClass(reserve: ReserveStateData): any {
        const result: any = {};

        if (!!this.flat === false) {
            result['my-3'] = true;
        }

        if (reserve.reserveItem.isSkip === true) {
            result.skip = true;
        } else if (reserve.reserveItem.isConflict === true) {
            result.conflict = true;
        } else if (reserve.reserveItem.isOverlap === true) {
            result.overlap = true;
        } else {
            result.reserve = true;
        }

        return result;
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
