<template>
    <v-card class="mx-auto recorded-table" max-width="1000px">
        <v-simple-table>
            <template v-slot:default>
                <thead>
                    <tr>
                        <td>タイトル</td>
                        <td class="channel">放送局</td>
                        <td class="time">時間</td>
                        <td class="menu"></td>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="item in items" v-bind:key="item.id" v-on:click="gotoDetail(item)">
                        <td>{{ item.display.name }}</td>
                        <td>{{ item.display.channelName }}</td>
                        <td>{{ item.display.shortTime }} ({{ item.display.duration }} m)</td>
                        <td class="menu">
                            <RecordedItemMenu
                                :recordedItem="item.recordedItem"
                                v-on:stopEncode="stopEncode"
                            ></RecordedItemMenu>
                        </td>
                    </tr>
                </tbody>
            </template>
        </v-simple-table>
    </v-card>
</template>

<script lang="ts">
import RecordedItemMenu from '@/components/recorded/RecordedItemMenu.vue';
import { RecordedDisplayData } from '@/model/state/recorded/IRecordedUtil';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({
    components: {
        RecordedItemMenu,
    },
})
export default class RecordedTableItems extends Vue {
    @Prop({ required: true })
    public items!: RecordedDisplayData[];

    public gotoDetail(item: RecordedDisplayData): void {
        this.$emit('detail', item.recordedItem.id);
    }

    public stopEncode(recordedId: apid.RecordedId): void {
        this.$emit('stopEncode', recordedId);
    }
}
</script>

<style lang="sass" scoped>
.recorded-table
    cursor: pointer
    .channel
        min-width: 180px
    .time
        width: 190px
    .menu
        width: 68px
</style>
