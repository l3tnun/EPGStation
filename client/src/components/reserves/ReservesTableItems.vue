<template>
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
                    <tr v-for="reserve in reserves" v-bind:key="reserve.reserveItem.id" v-on:click="clickItem">
                        <td>{{ reserve.display.channelName }}</td>
                        <td>{{ reserve.display.day }}({{ reserve.display.dow }})</td>
                        <td>
                            {{ reserve.display.startTime }}~{{ reserve.display.endTime }}
                            <div>({{ reserve.display.duration }}m)</div>
                        </td>
                        <td>{{ reserve.display.name }}</td>
                        <td>{{ reserve.display.description }}</td>
                        <td>
                            <ReserveMenu :reserveItem="reserve.reserveItem" :disableEdit="false"></ReserveMenu>
                        </td>
                    </tr>
                </tbody>
            </template>
        </v-simple-table>
    </v-card>
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
export default class ReservesTableItems extends Vue {
    @Prop({
        required: true,
    })
    public reserves!: ReserveStateData[];

    public clickItem(): void {
        console.log('click item');
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
</style>
