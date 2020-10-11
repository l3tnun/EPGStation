<template>
    <div>
        <ReservesTableItems v-if="isTable === true" :reserves="reserves" :isEditMode.sync="isEditMode" v-on:selected="selected"></ReservesTableItems>
        <v-card v-else class="mx-auto">
            <ReservesCard :reserves="reserves" :flat="true" :isEditMode.sync="isEditMode" v-on:selected="selected"></ReservesCard>
        </v-card>
    </div>
</template>

<script lang="ts">
import ReservesCard from '@/components/reserves/ReservesCard.vue';
import ReservesTableItems from '@/components/reserves/ReservesTableItems.vue';
import { ReserveStateData } from '@/model/state/reserve/IReserveStateUtil';
import ResizeObserver from 'resize-observer-polyfill';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({
    components: {
        ReservesCard,
        ReservesTableItems,
    },
})
export default class ReserveItems extends Vue {
    @Prop({ required: true })
    public reserves!: ReserveStateData[];

    @Prop({ required: true })
    public isEditMode!: boolean;

    public isTable: boolean = false;

    private resizeObserver: ResizeObserver | null = null;

    public mounted(): void {
        // set resize observer
        this.resizeObserver = new ResizeObserver(() => {
            this.isTable = this.$el.clientWidth >= 900;
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

    public selected(reserveId: apid.ReserveId): void {
        this.$emit('selected', reserveId);
    }
}
</script>
