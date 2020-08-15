<template>
    <div>
        <ReservesTableItems v-if="isTable === true" :reserves="reserves"></ReservesTableItems>
        <v-card v-else class="mx-auto">
            <ReservesCard :reserves="reserves" :flat="true"></ReservesCard>
        </v-card>
    </div>
</template>

<script lang="ts">
import ReservesCard from '@/components/reserves/ReservesCard.vue';
import ReservesTableItems from '@/components/reserves/ReservesTableItems.vue';
import { ReserveStateData } from '@/model/state/reserve/IReserveStateUtil';
import ResizeObserver from 'resize-observer-polyfill';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({
    components: {
        ReservesCard,
        ReservesTableItems,
    },
})
export default class ReserveItems extends Vue {
    @Prop({
        required: true,
    })
    public reserves!: ReserveStateData[];

    public isTable: boolean = false;

    private resizeObserver: ResizeObserver | null = null;

    public mounted(): void {
        // set resize observer
        this.resizeObserver = new ResizeObserver(() => {
            this.isTable = this.$el.clientWidth >= 900;
        });
        this.resizeObserver!.observe(this.$el);
    }

    public beforeDestroy(): void {
        // disconnect resize observer
        if (this.resizeObserver !== null) {
            this.resizeObserver.disconnect();
        }
    }
}
</script>
