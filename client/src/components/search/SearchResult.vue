<template>
    <div v-if="searchState.getSearchResult() !== null" class="search-result mx-auto my-8">
        <div class="d-flex align-center justify-end">
            <v-btn icon v-on:click="jumpResultOption">
                <v-icon>mdi-link</v-icon>
            </v-btn>
            <div class="ml-1">{{ searchState.getSearchResult().length }} 件ヒット</div>
        </div>
        <SearchResultCard v-for="program in searchState.getSearchResult()" v-bind:key="program.id" :program="program"></SearchResultCard>
    </div>
</template>

<script lang="ts">
import SearchResultCard from '@/components/search/SearchResultCard.vue';
import container from '@/model/ModelContainer';
import ISearchState from '@/model/state/search/ISearchState';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({
    components: {
        SearchResultCard,
    },
})
export default class SearchResult extends Vue {
    public searchState: ISearchState = container.get<ISearchState>('ISearchState');

    public jumpResultOption(): void {
        this.$emit('ruleOption');
    }
}
</script>

<style lang="sass" scoped>
.search-result
    width: 100%
    max-width: 800px
</style>
