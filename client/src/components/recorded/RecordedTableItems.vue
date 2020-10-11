<template>
    <v-card class="mx-auto recorded-table" max-width="1000px">
        <v-simple-table>
            <template v-slot:default>
                <thead>
                    <tr>
                        <th>タイトル</th>
                        <th class="channel">放送局</th>
                        <th class="time">時間</th>
                        <th class="menu"></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="item in items" v-bind:key="item.id" v-on:click="gotoDetail(item)" v-bind:class="{ 'selected-color': item.isSelected === true }">
                        <td>{{ item.display.name }}</td>
                        <td>{{ item.display.channelName }}</td>
                        <td>{{ item.display.shortTime }} ({{ item.display.duration }} m)</td>
                        <td class="menu">
                            <RecordedItemMenu v-if="isEditMode === false" :recordedItem="item.recordedItem" v-on:stopEncode="stopEncode"></RecordedItemMenu>
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

    @Prop({ required: true })
    public isEditMode!: boolean;

    @Prop({ required: true })
    public isShowDropInfo!: boolean;

    public gotoDetail(item: RecordedDisplayData): void {
        if (this.isEditMode === true) {
            this.$emit('selected', item.recordedItem.id);

            return;
        }
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
