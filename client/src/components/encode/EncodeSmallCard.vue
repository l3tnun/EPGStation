<template>
    <div>
        <v-card :ripple="false" v-bind:class="{ 'selected-color': item.isSelected === true }">
            <div class="d-flex my-1 recorded-small-card" v-on:click="clickItem">
                <v-img aspect-ratio="1.7778" :src="item.display.topThumbnailPath" v-on:error="this.src = './img/noimg.png'" eager class="thumbnail"></v-img>
                <div class="content pa-2 my-auto">
                    <div class="d-flex align-center">
                        <div class="text mt-1 subtitle-2 font-weight-bold">{{ item.display.name }}</div>
                        <div v-if="isEditMode === false" class="menu-wrap">
                            <v-btn icon class="menu-button" v-on:click="openCancelDialog">
                                <v-icon>mdi-close</v-icon>
                            </v-btn>
                        </div>
                    </div>
                    <div class="text caption font-weight-light">{{ item.display.channelName }}</div>
                    <div class="text caption font-weight-light">{{ item.display.time }} ({{ item.display.duration }} m)</div>
                    <div class="text caption font-regular">{{ item.display.mode }}</div>
                    <div class="text caption font-regular">{{ item.display.encodeInfo }}</div>
                    <v-progress-linear v-if="typeof item.display.percent !== 'undefined'" buffer-value="100" :value="item.display.percent"></v-progress-linear>
                </div>
            </div>
        </v-card>
        <EncodeCancelDialog :isOpen.sync="isOpenCancelDialog" :item="item.encodeItem"></EncodeCancelDialog>
    </div>
</template>

<script lang="ts">
import EncodeCancelDialog from '@/components/encode/EncodeCancelDialog.vue';
import { EncodeInfoDisplayItem } from '@/model/state/encode/IEncodeState';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({
    components: {
        EncodeCancelDialog,
    },
})
export default class EncodeSmallCard extends Vue {
    @Prop({ required: true })
    public item!: EncodeInfoDisplayItem;

    @Prop({ required: true })
    public isEditMode!: boolean;

    public isOpenCancelDialog: boolean = false;

    public openCancelDialog(): void {
        this.isOpenCancelDialog = true;
    }

    public clickItem(): void {
        if (this.isEditMode === false) {
            return;
        }

        this.$emit('selected', this.item.encodeItem.id);
    }
}
</script>

<style lang="sass" scoped>
.recorded-small-card
    max-width: 100%
    cursor: default

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
