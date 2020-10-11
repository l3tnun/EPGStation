<template>
    <v-card :max-width="width" flat class="ma-1 recorded-large-card" v-bind:class="{ 'selected-color': item.isSelected === true }">
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
                <RecordedItemMenu v-if="isEditMode === false" :recordedItem="item.recordedItem" v-on:stopEncode="stopEncode"></RecordedItemMenu>
            </div>
            <div class="text caption font-weight-light">{{ item.display.channelName }}</div>
            <div class="text caption font-weight-light">{{ item.display.time }} ({{ item.display.duration }} m)</div>
            <div
                v-if="isShowDropInfo === true && typeof item.display.drop !== 'undefined'"
                class="text caption font-weight-light"
                v-bind:class="{ droped: item.display.hasDrop === true }"
            >
                {{ item.display.drop }}
            </div>
            <div
                v-else-if="typeof item.display.description === 'undefined' || item.display.description.replace(/\s+/g, '').length === 0"
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

    @Prop({ required: true })
    public isEditMode!: boolean;

    @Prop({ required: true })
    public isShowDropInfo!: boolean;

    public gotoDetail(): void {
        if (this.isEditMode === true) {
            this.$emit('selected', this.item.recordedItem.id);

            return;
        }
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

    .droped
        color: red
        font-weight: bold !important

    .dummy
        visibility: hidden
</style>
