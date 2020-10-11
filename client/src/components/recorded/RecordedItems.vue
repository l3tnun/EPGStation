<template>
    <div ref="wrap" class="recorded-wrap">
        <div v-if="cardNum > 1 && !!isTableMode === false" v-bind:style="contentStyle" class="recorded-content d-flex flex-wrap mx-auto">
            <div v-for="r in recorded" v-bind:key="r.recordedItem.id">
                <RecordedLargeCard
                    :width="largeCardWidth"
                    :item="r"
                    :isEditMode="isEditMode"
                    :isShowDropInfo="isShowDropInfo"
                    v-on:detail="gotoDetail"
                    v-on:stopEncode="stopEncode"
                    v-on:selected="selected"
                ></RecordedLargeCard>
            </div>
        </div>
        <div v-else-if="cardNum > 1 && !!isTableMode === true">
            <RecordedTableItems
                :items="recorded"
                :isEditMode="isEditMode"
                :isShowDropInfo="isShowDropInfo"
                v-on:detail="gotoDetail"
                v-on:stopEncode="stopEncode"
                v-on:selected="selected"
            ></RecordedTableItems>
            <div v-for="r in recorded" v-bind:key="r.recordedItem.id"></div>
        </div>
        <div v-else>
            <div v-for="r in recorded" v-bind:key="r.recordedItem.id">
                <RecordedsmallCard
                    :item="r"
                    :isEditMode="isEditMode"
                    :isShowDropInfo="isShowDropInfo"
                    v-on:detail="gotoDetail"
                    v-on:stopEncode="stopEncode"
                    v-on:selected="selected"
                    :noThumbnail="!!isRecording === true"
                ></RecordedsmallCard>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import RecordedLargeCard from '@/components/recorded/RecordedLargeCard.vue';
import RecordedsmallCard from '@/components/recorded/RecordedSmallCard.vue';
import RecordedTableItems from '@/components/recorded/RecordedTableItems.vue';
import { RecordedDisplayData } from '@/model/state/recorded/IRecordedUtil';
import ResizeObserver from 'resize-observer-polyfill';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({
    components: {
        RecordedsmallCard,
        RecordedLargeCard,
        RecordedTableItems,
    },
})
class RecordedItems extends Vue {
    @Prop({ required: true })
    public recorded!: RecordedDisplayData[];

    @Prop({ required: false })
    public isTableMode: boolean | undefined;

    @Prop({ required: false })
    public isRecording: boolean | undefined;

    @Prop({ required: true })
    public isEditMode!: boolean;

    @Prop({ required: true })
    public isShowDropInfo!: boolean;

    get contentStyle(): any {
        return {
            'max-width': `${this.cardNum * (RecordedItems.CARD_WIDTH + RecordedItems.CARD_MARGIN)}px`,
        };
    }

    get largeCardWidth(): number {
        return RecordedItems.CARD_WIDTH;
    }

    private cardNum = 1;
    private resizeObserver: ResizeObserver | null = null;

    public mounted(): void {
        // set resize observer
        this.resizeObserver = new ResizeObserver(() => {
            this.cardNum = Math.floor(this.$el.clientWidth / (RecordedItems.CARD_WIDTH + RecordedItems.CARD_MARGIN));
        });
        if (this.resizeObserver !== null) {
            this.resizeObserver.observe(this.$el);
        }
    }

    public beforeDestroy(): void {
        // disconnect resize observer
        if (this.resizeObserver !== null) {
            this.resizeObserver.disconnect();
        }
    }

    public gotoDetail(recordedId: apid.RecordedId): void {
        this.$emit('detail', recordedId);
    }

    public stopEncode(recordedId: apid.RecordedId): void {
        this.$emit('stopEncode', recordedId);
    }

    public selected(recordedId: apid.RecordedId): void {
        this.$emit('selected', recordedId);
    }
}

namespace RecordedItems {
    export const CARD_WIDTH = 300;
    export const CARD_MARGIN = 8;
}

export default RecordedItems;
</script>
