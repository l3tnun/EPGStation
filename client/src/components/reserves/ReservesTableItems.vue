<template>
    <div>
        <v-card class="mx-auto reserves-table" max-width="1600px">
            <v-simple-table>
                <template v-slot:default>
                    <thead>
                        <tr>
                            <th class="channel">放送局</th>
                            <th class="day">日付</th>
                            <th class="time">時間</th>
                            <th>番組名</th>
                            <th>内容</th>
                            <th class="menu"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="reserve in reserves"
                            v-bind:key="reserve.reserveItem.id"
                            v-bind:class="{ 'selected-color': reserve.isSelected === true }"
                            v-on:click="clickItem(reserve)"
                        >
                            <td>{{ reserve.display.channelName }}</td>
                            <td>{{ reserve.display.day }}({{ reserve.display.dow }})</td>
                            <td>
                                {{ reserve.display.startTime }}~{{ reserve.display.endTime }}
                                <div>({{ reserve.display.duration }}m)</div>
                            </td>
                            <td>
                                <v-icon v-if="reserve.display.isRule === true" class="reserve-icon">mdi-calendar</v-icon>
                                <v-icon v-else class="reserve-icon">mdi-timer-outline</v-icon>
                                {{ reserve.display.name }}
                            </td>
                            <td>{{ reserve.display.description }}</td>
                            <td>
                                <ReserveMenu v-if="isEditMode === false" :reserveItem="reserve.reserveItem" :disableEdit="false"></ReserveMenu>
                            </td>
                        </tr>
                    </tbody>
                </template>
            </v-simple-table>
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
export default class ReservesTableItems extends Vue {
    @Prop({
        required: true,
    })
    public reserves!: ReserveStateData[];

    @Prop({ required: true })
    public isEditMode!: boolean;

    public isOpenDialog: boolean = false;
    public dialogReserve: ReserveStateData | null = null;

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
.reserves-table
    cursor: pointer
    .channel
        min-width: 160px
    .day
        min-width: 96px
    .time
        min-width: 110px
    .menu
        width: 68px

    tbody > tr > td
        padding-top: 8px !important
        padding-bottom: 8px !important

    .reserve-icon
        font-size: 20px !important
        padding-bottom: 2px
</style>
