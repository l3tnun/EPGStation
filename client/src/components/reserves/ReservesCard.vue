<template>
    <div v-bind:class="{ 'needs-decoration': !!needsDecoration }">
        <v-card v-for="reserve in reserves" v-bind:key="reserve.id" v-bind:class="getClass(reserve)" class="reserve-card mx-auto" :flat="!!flat" style="cursor: pointer">
            <v-list-item class="px-3" three-line>
                <div style="width: 100%" v-on:click="clickItem(reserve)">
                    <v-list-item-content>
                        <div class="d-flex">
                            <div class="subtitle-1 font-weight-black">
                                <v-icon v-if="reserve.display.isRule === true" class="reserve-icon">mdi-calendar</v-icon>
                                <v-icon v-else class="reserve-icon">mdi-timer-outline</v-icon>
                                <span class="pt-1 pl-1">{{ reserve.display.name }}</span>
                            </div>
                            <v-spacer></v-spacer>
                            <ReserveMenu v-if="isEditMode === false" :reserveItem="reserve.reserveItem" :disableEdit="disableEdit"></ReserveMenu>
                        </div>
                        <div class="subtitle-2 font-weight-light">{{ reserve.display.channelName }}</div>
                        <div class="caption font-weight-light mb-2">
                            {{ reserve.display.day }}({{ reserve.display.dow }}) {{ reserve.display.startTime }} ~ {{ reserve.display.endTime }} ({{ reserve.display.duration }}分)
                        </div>
                        <div class="body-2 font-weight-light">{{ reserve.display.description }}</div>
                    </v-list-item-content>
                </div>
            </v-list-item>
        </v-card>
        <ReserveDialog :isOpen.sync="isOpenDialog" :reserve="dialogReserve"></ReserveDialog>
    </div>
</template>

<script lang="ts">
import ReserveDialog from '@/components/reserves/ReserveDialog.vue';
import ReserveMenu from '@/components/reserves/ReserveMenu.vue';
import { ReserveStateData } from '@/model/state/reserve/IReserveStateUtil';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({
    components: {
        ReserveMenu,
        ReserveDialog,
    },
})
export default class ReservesCard extends Vue {
    @Prop({
        required: true,
    })
    public reserves!: ReserveStateData[];

    @Prop({ required: true })
    public isEditMode!: boolean;

    @Prop({ required: false })
    public needsDecoration: boolean | undefined;

    @Prop({ required: false })
    public disableEdit: boolean | undefined;

    @Prop({ required: false })
    public flat: boolean | undefined;

    public isOpenDialog: boolean = false;
    public dialogReserve: ReserveStateData | null = null;

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

        if (reserve.isSelected === true) {
            result['selected-color'] = true;
        }

        return result;
    }

    public clickItem(reserve: ReserveStateData): void {
        if (this.isEditMode === true) {
            this.$emit('selected', reserve.reserveItem.id);

            return;
        }

        this.dialogReserve = reserve;
        this.isOpenDialog = true;
    }
}
</script>

<style lang="sass" scoped>
.reserve-card
    &.selected-color
        > .v-list-item
            color: white !important
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

.reserve-icon
    font-size: 20px !important
    padding-bottom: 2px
</style>
