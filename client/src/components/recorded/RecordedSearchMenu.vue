<template>
    <div>
        <v-menu v-model="isOpen" bottom left :close-on-content-click="false">
            <template v-slot:activator="{ on }">
                <v-btn dark icon v-on="on">
                    <v-icon>mdi-magnify</v-icon>
                </v-btn>
            </template>
            <v-card width="400">
                <div class="recorded-search pa-4">
                    <v-text-field v-model="searchState.keyword" label="キーワード" clearable v-on:keydown.enter="onSearch()" ref="keyword"></v-text-field>
                    <v-autocomplete
                        v-model="searchState.ruleId"
                        :disabled="isNoRule === true"
                        :loading="loading"
                        :items="searchState.ruleItems"
                        :search-input.sync="search"
                        item-text="keyword"
                        item-value="id"
                        cache-items
                        flat
                        hide-no-data
                        hide-details
                        clearable
                        label="ルール"
                        class="pb-2"
                    ></v-autocomplete>
                    <v-select v-model="searchState.channelId" :items="searchState.channelItems" label="放送局" clearable :menu-props="{ auto: true }"></v-select>
                    <v-select v-model="searchState.genre" :items="searchState.genreItems" label="ジャンル" clearable :menu-props="{ auto: true }"></v-select>
                    <div class="check-boxes">
                        <v-checkbox v-model="searchState.hasOriginalFile" label="元ファイルを含む" class="mt-2"></v-checkbox>
                        <v-checkbox v-model="isNoRule" label="手動録画のみ" class="mt-2"></v-checkbox>
                    </div>
                </div>
                <v-divider></v-divider>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn v-on:click="onCancel" text color="error">閉じる</v-btn>
                    <v-btn v-on:click="onSearch" text color="primary">検索</v-btn>
                </v-card-actions>
            </v-card>
        </v-menu>
        <div v-if="isOpen === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IRecordedSearchState from '@/model/state/recorded/search/IRecordedSearchState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import VuetifyUtil from '@/util/VuetifyUtil';
import { Component, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class RecordedSearchMenu extends Vue {
    public loading: boolean = false;
    public search: string | null = null;
    public isNoRule: boolean = false;

    @Watch('search', { immediate: true })
    public async onChangeSearch(newKeyword: string): Promise<void> {
        if (newKeyword === null || newKeyword === this.searchState.ruleKeyword) {
            return;
        }

        this.searchState.ruleKeyword = newKeyword;
        await this.searchState.updateRuleItems();
    }

    public isOpen: boolean = false;
    public searchState: IRecordedSearchState = container.get<IRecordedSearchState>('IRecordedSearchState');

    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public onCancel(): void {
        this.isOpen = false;
    }

    public onSearch(): void {
        this.isOpen = false;

        this.$nextTick(async () => {
            await Util.sleep(300);

            const searchQuery: any = {};
            if (typeof this.searchState.keyword !== 'undefined') {
                searchQuery.keyword = this.searchState.keyword;
            }
            if (this.isNoRule === true) {
                this.searchState.ruleId = 0;
                searchQuery.ruleId = 0;
            } else if (typeof this.searchState.ruleId !== 'undefined' && this.searchState.ruleId !== null) {
                searchQuery.ruleId = this.searchState.ruleId;
            }
            if (typeof this.searchState.channelId !== 'undefined' && this.searchState.channelId !== null) {
                searchQuery.channelId = this.searchState.channelId;
            }
            if (typeof this.searchState.genre !== 'undefined' && this.searchState.genre !== null) {
                searchQuery.genre = this.searchState.genre;
            }
            if (this.searchState.hasOriginalFile === true) {
                searchQuery.hasOriginalFile = true;
            }

            await Util.move(this.$router, {
                path: '/recorded',
                query: searchQuery,
            });
        });
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }

    /**
     * ページ移動時
     */
    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.isOpen = false;

        this.setRuleId();
        this.searchState.fetchData().catch(err => {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: '録画検索オプションの取得に失敗',
            });
        });
    }

    private setRuleId(): void {
        const ruleId = typeof this.$route.query.ruleId === 'undefined' ? null : parseInt(this.$route.query.ruleId as string, 10);
        this.searchState.ruleId = ruleId === null || isNaN(ruleId) === false ? ruleId : null;
        if (this.searchState.ruleId === 0) {
            this.isNoRule = true;
        }
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && oldState === false) {
            this.searchState.initValues();
            this.isNoRule = false;

            // query から値をセット
            this.setRuleId();
            if (typeof this.$route.query.keyword === 'string') {
                this.searchState.keyword = this.$route.query.keyword;
            }
            if (typeof this.$route.query.channelId !== 'undefined') {
                this.searchState.channelId = parseInt(this.$route.query.channelId as string, 10);
            }
            if (typeof this.$route.query.genre !== 'undefined') {
                this.searchState.genre = parseInt(this.$route.query.genre as string, 10);
            }
            if (typeof this.$route.query.hasOriginalFile !== 'undefined') {
                this.searchState.hasOriginalFile = (this.$route.query.hasOriginalFile as any) === true || this.$route.query.hasOriginalFile === 'true';
            }

            // キーワードにフォーカスを当てる
            this.$nextTick(() => {
                if (typeof this.$refs.keyword !== 'undefined') {
                    VuetifyUtil.focusTextFiled(this.$refs.keyword as Vue);
                }
            });
        }
    }
}
</script>

<style lang="sass">
.recorded-search
    .v-input__control
        .v-input__slot
            margin: 0 !important
        .v-messages
            display: none

    .check-boxes
        display: flex
        flex-wrap: wrap
        .v-input--checkbox
            padding-right: 8px
</style>
