<template>
    <v-card :ripple="false" flat tile class="d-flex my-1 recorded-small-card">
        <v-img
            v-if="noThumbnail === false"
            aspect-ratio="1.7778"
            :src="item.display.topThumbnailPath"
            v-on:error="this.src = './img/noimg.png'"
            v-on:click="gotoDetail"
            eager
            class="thumbnail"
        ></v-img>
        <div v-on:click="gotoDetail" class="content pa-2 my-auto">
            <div class="d-flex align-center">
                <div class="text mt-1 subtitle-2 font-weight-bold">{{ item.display.name }}</div>
                <div class="menu-wrap">
                    <RecordedItemMenu :recordedItem="item.recordedItem" v-on:stopEncode="stopEncode"></RecordedItemMenu>
                </div>
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
export default class RecordedSmallCard extends Vue {
    @Prop({ required: true })
    public item!: RecordedDisplayData;

    @Prop()
    public noThumbnail: boolean | undefined;

    public gotoDetail(): void {
        this.$emit('detail', this.item.recordedItem.id);
    }

    public stopEncode(recordedId: apid.RecordedId): void {
        this.$emit('stopEncode', recordedId);
    }
}
</script>

<style lang="sass" scoped>
.recorded-small-card
    max-width: 100%
    height: 100px
    cursor: pointer

    .thumbnail
        flex-basis: 30%
        max-width: 200px
        border-bottom-left-radius: inherit
        border-top-right-radius: unset !important

    .content
        flex-basis: 100%
        min-width: 0
        overflow-wrap: break-word
        word-wrap: break-word
        .text
            overflow: hidden
            text-overflow: ellipsis
            white-space: nowrap
        .subtitle-2
            padding-right: 30px
        .dummy
            visibility: hidden

    .menu-wrap
        position: absolute
        right: 0
        margin-top: 2px
        margin-right: 4px
</style>
