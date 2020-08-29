<template>
    <div>
        <div v-for="item in items" v-bind:key="item.encodeItem.id">
            <EncodeSmallCard :item="item" :isEditMode.sync="isEditMode" v-on:selected="selected"></EncodeSmallCard>
        </div>
    </div>
</template>

<script lang="ts">
import EncodeSmallCard from '@/components/encode/EncodeSmallCard.vue';
import { EncodeInfoDisplayData } from '@/model/state/encode/IEncodeState';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({
    components: {
        EncodeSmallCard,
    },
})
export default class EncodeItems extends Vue {
    @Prop({ required: true })
    public items!: EncodeInfoDisplayData[];

    @Prop({ required: true })
    public isEditMode!: boolean;

    public selected(encodeId: apid.EncodeId): void {
        this.$emit('selected', encodeId);
    }
}
</script>
