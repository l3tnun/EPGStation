<template>
    <v-card :max-width="width" flat class="ma-1 recorded-large-card">
        <v-img
            aspect-ratio="1.7778"
            :min-width="width"
            :src="item.display.topThumbnailPath"
            v-on:error="this.src = './img/noimg.png'"
            v-on:click="gotoDetail"
            :eager="true"
        ></v-img>
        <div class="pa-2" v-on:click="gotoDetail">
            <div class="d-flex align-center">
                <div class="text subtitle-2 font-weight-bold">{{ item.display.name }}</div>
                <v-spacer></v-spacer>
                <RecordedItemMenu :recordedItem="item.recordedItem" v-on:stopEncode="stopEncode"></RecordedItemMenu>
            </div>
            <div class="text caption font-weight-light">{{ item.display.channelName }}</div>
            <div class="text caption font-weight-light">{{ item.display.time }} ({{ item.display.duration }} m)</div>
            <div
                v-if="
                    typeof item.display.description === 'undefined' ||
                    item.display.description.replace(/\s+/g, '').length === 0
                "
                class="text caption font-weight-light dummy"
            >
                dummy
            </div>
            <div v-else class="text caption font-regular">{{ item.display.description }}</div>
        </div>
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
export default class RecordedLargeCard extends Vue {
    @Prop({ required: true })
    public width!: number;

    @Prop({ required: true })
    public item!: RecordedDisplayData;

    public gotoDetail(): void {
        this.$emit('detail', this.item.recordedItem.id);
    }

    public stopEncode(recordedId: apid.RecordedId): void {
        this.$emit('stopEncode', recordedId);
    }
}
</script>

<style lang="sass" scoped>
.recorded-large-card
    cursor: pointer
    .text
        overflow: hidden
        text-overflow: ellipsis
        white-space: nowrap

    .dummy
        visibility: hidden
</style>
