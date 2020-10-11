<template>
    <div class="genre">
        <v-select
            :items="genreSelectionItems"
            v-model="searchState.genreSelect"
            :menu-props="{ auto: true }"
            :disabled="searchState.searchOption.isShowSubgenres === false"
            v-on:change="onChangeGenreSelector"
        ></v-select>
        <v-card ref="card" class="overflow-auto pa-1 mt-4" width="100%" max-height="180px" overflow-scroll outlined>
            <div v-for="genre in genreItems" v-bind:key="genre.value">
                <div class="item" v-bind:class="{ selected: searchState.searchOption.genres[genre.value].isEnable === true }" v-on:click="onClickGenre(genre.value)">
                    {{ genre.name }}
                </div>
                <div v-if="searchState.searchOption.isShowSubgenres === true">
                    <div
                        v-for="subGenre in genre.subGenres"
                        v-bind:key="subGenre.value"
                        class="sub-genre item"
                        v-bind:class="{
                            selected: searchState.searchOption.genres[genre.value].subGenreIndex[subGenre.value] === true,
                        }"
                        v-on:click="onClickSubGenre(genre.value, subGenre.value)"
                    >
                        {{ subGenre.name }}
                    </div>
                </div>
            </div>
        </v-card>
        <div class="d-flex mt-2">
            <v-checkbox class="mx-1 my-1" label="サブジャンル表示" v-model="searchState.searchOption.isShowSubgenres" :disabled="searchState.genreSelect !== -1"></v-checkbox>
            <v-btn v-on:click="cleatGenres" class="mx-1" color="primary">クリア</v-btn>
        </div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISearchState, { GenreItem, SelectorItem } from '@/model/state/search/ISearchState';
import { cloneDeep } from 'lodash';
import { Component, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class SearchGenreOption extends Vue {
    public searchState: ISearchState = container.get<ISearchState>('ISearchState');

    get genreSelectionItems(): SelectorItem[] {
        const result = this.searchState.getGenreItems().map(g => {
            return {
                text: g.name,
                value: g.value,
            };
        });

        result.unshift({
            text: 'すべて',
            value: -1,
        });

        return result;
    }

    get genreItems(): GenreItem[] {
        if (this.searchState.genreSelect === -1) {
            return this.searchState.getGenreItems();
        }

        return this.searchState.getGenreItems().filter(g => {
            return g.value === this.searchState.genreSelect;
        });
    }

    /**
     * ジャンル絞り込み状態変更
     */
    public onChangeGenreSelector(): void {
        if (typeof this.$refs.card === 'undefined') {
            return;
        }
        (this.$refs.card as any).$el.scrollTop = 0;
    }

    /**
     * ジャンル選択処理
     * @param genre: apid.ProgramGenreLv1
     */
    public onClickGenre(genre: apid.ProgramGenreLv1): void {
        this.searchState.onClickGenre(genre);
        this.updateGenreView();
    }

    /**
     * サブジャンル選択処理
     * @param genre: apid.ProgramGenreLv1
     * @param subGenre: apid.ProgramGenreLv2
     */
    public onClickSubGenre(genre: apid.ProgramGenreLv1, subGenre: apid.ProgramGenreLv2): void {
        this.searchState.onClickSubGenre(genre, subGenre);
        this.updateGenreView();
    }

    /**
     * ジャンル選択クリア処理
     */
    public cleatGenres(): void {
        this.searchState.clearGenres();
        this.updateGenreView();
    }

    /**
     * searchState.searchOption.genres の更新を vue に伝える
     */
    private updateGenreView(): void {
        if (this.searchState.searchOption === null) {
            return;
        }

        const newGenres = cloneDeep(this.searchState.searchOption.genres);
        this.$set(this.searchState.searchOption, 'genres', newGenres);
    }
}
</script>

<style lang="sass" scoped>
.genre
    .item
        cursor: pointer
        user-select: none
        padding: 6px
    .selected
        background-color: rgb(33, 150, 243, 0.1)
        color: #2196f3
        caret-color: #2196f3
    .sub-genre
        text-indent: 1em
</style>
