<template>
    <div v-if="reserves.length > 0" class="rule-reserves mx-auto my-5">
        <div class="result-text pb-2">予約数 {{ reserves.length }} 件</div>
        <ReservesCard :reserves="reserves" :isEditMode="false" :needsDecoration="true" :disableEdit="true"></ReservesCard>
    </div>
    <div v-else style="visibility: hidden">dummy</div>
</template>

<script lang="ts">
import ReservesCard from '@/components/reserves/ReservesCard.vue';
import { ReserveStateData } from '@/model/state/reserve/IReserveStateUtil';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({
    components: {
        ReservesCard,
    },
})
export default class SearchReserves extends Vue {
    @Prop({
        required: true,
    })
    public reserves!: ReserveStateData[];
}
</script>

<style lang="sass" scoped>
.rule-reserves
    max-width: 800px

.result-text
    text-align: right
</style>
