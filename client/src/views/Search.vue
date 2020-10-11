<template>
    <v-content>
        <TitleBar ref="title" :title="this.searchState.isEditingRule() === true ? 'ルール編集' : '検索'"></TitleBar>
        <transition name="page">
            <div ref="appContent" class="app-content pa-3" v-bind:style="{ visibility: isVisible === true ? 'visible' : 'hidden' }" v-if="isShow === true">
                <SearchOptionComponent ref="searchOption" v-if="searchState.searchOption !== null" v-on:search="search" v-on:clear="clear"></SearchOptionComponent>
                <SearchReserves v-if="searchState.isTimeSpecification === true" :reserves="searchState.getRuleReservesResult()"></SearchReserves>
                <SearchResult ref="searchResult" v-if="searchState.isTimeSpecification === false" v-on:ruleOption="scrollToRuleOption"></SearchResult>
                <SearchRuleOption ref="ruleOption" v-on:add="add" v-on:update="update"></SearchRuleOption>
                <v-btn v-on:click="scrollToTop" dark fixed bottom fab color="pink">
                    <v-icon>mdi-chevron-up</v-icon>
                </v-btn>
                <div class="fab-space"></div>
                <ProgramDialog></ProgramDialog>
            </div>
        </transition>
    </v-content>
</template>

<script lang="ts">
import ProgramDialog from '@/components/guide/ProgramDialog.vue';
import SearchOptionComponent from '@/components/search/SearchOption.vue';
import SearchReserves from '@/components/search/SearchReserves.vue';
import SearchResult from '@/components/search/SearchResult.vue';
import SearchRuleOption from '@/components/search/SearchRuleOption.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import ISearchState, { EncodedOption, QuerySearchOption, ReserveOption, SaveOption, SearchOption, TimeReserveOption } from '@/model/state/search/ISearchState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';
import { cloneDeep } from 'lodash';
import { Component, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';
import * as apid from '../../../api';

interface PageInfo {
    isTimeSpecification: boolean;
    searchOption: SearchOption | null;
    timeReserveOption: TimeReserveOption | null;
    reserveOption: ReserveOption | null;
    saveOption: SaveOption | null;
    encodeOption: EncodedOption | null;
    isSearched: boolean;
    genreSelect: number;
}

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
        SearchOptionComponent,
        SearchResult,
        SearchReserves,
        SearchRuleOption,
        ProgramDialog,
    },
})
export default class Search extends Vue {
    public isShow: boolean = false;
    public isVisible: boolean = false;

    private searchState: ISearchState = container.get<ISearchState>('ISearchState');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = ((): void => {
        this.updateSocketIoState();
    }).bind(this);

    public created(): void {
        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);

        this.isShow = false;
    }

    public async search(needsScroll: boolean = true): Promise<void> {
        this.searchState.prepSearch();
        this.clearPeriodState();

        // 検索
        try {
            await this.searchState.fetchSearchResult();
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: '検索に失敗',
            });
            console.error(err);

            return;
        }

        // 検索後にスクロール
        if (needsScroll === true) {
            this.$nextTick(() => {
                this.scrollToElementHead(this.$refs.searchResult as Vue);
            });
        }
    }

    /**
     * 指定した Vue の先頭までスクロールする
     * @param vue: Vue | undefined
     * @param offset: number default = 0
     */
    private scrollToElementHead(vue: Vue | undefined, offset: number = 0): void {
        if (typeof vue === 'undefined') {
            this.snackbarState.open({
                color: 'error',
                text: 'スクロールに失敗',
            });

            return;
        }

        window.scrollTo({
            top: vue.$el.getBoundingClientRect().top + window.pageYOffset - this.getTitleHeight() - offset,
            behavior: 'smooth',
        });
    }

    /**
     * Title の高さを取得する
     */
    private getTitleHeight(): number {
        if (typeof this.$refs.title === 'undefined') {
            throw new Error('TitleElementIsUndefined');
        }

        return ((this.$refs.title as Vue).$el as HTMLElement).clientHeight;
    }

    private clearPeriodState(): void {
        this.searchState.isShowPeriod = false;
        this.$nextTick(() => {
            this.searchState.isShowPeriod = true;
        });
    }

    public clear(): void {
        this.searchState.clear();
        this.clearPeriodState();
    }

    public async add(): Promise<void> {
        try {
            await this.searchState.addRule();
            this.snackbarState.open({
                color: 'success',
                text: 'ルール追加に成功',
            });

            await Util.sleep(1000);
            this.$router.back();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'ルール追加に失敗',
            });
        }
    }

    public async update(): Promise<void> {
        try {
            await this.searchState.updateRule();
            this.snackbarState.open({
                color: 'success',
                text: 'ルール更新に成功',
            });

            await Util.sleep(1000);
            this.$router.back();
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'ルール更新に失敗',
            });
        }
    }

    public scrollToTop(): void {
        (window as any).scrollTo({
            top,
            behavior: 'smooth',
        });
    }

    public scrollToRuleOption(): void {
        this.scrollToElementHead(this.$refs.ruleOption as Vue, 4);
    }

    /**
     * socket.io による状態更新通知時呼ばれる
     */
    private async updateSocketIoState(): Promise<void> {
        if (this.searchState.isTimeSpecification === false) {
            // 検索情報更新
            await this.searchState.fetchSearchResult().catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '検索情報更新に失敗',
                });
            });
        } else if (this.searchState.isEditingRule() === true) {
            // 時刻予約ルールの予約情報更新
            await this.searchState.fetchRuleReserves().catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '予約情報更新に失敗',
                });
            });
        }
    }

    /**
     * ページ更新時に呼ばれる
     */
    public beforeRouteUpdate(to: Route, from: Route, next: () => void): void {
        this.savePageInfo();
        next();
    }

    /**
     * ページ離脱時に呼ばれる
     */
    public beforeRouteLeave(to: Route, from: Route, next: () => void): void {
        this.savePageInfo();
        next();
    }

    /**
     * ページ情報を保存する
     */
    private savePageInfo(): void {
        // ルール編集の場合は何も保存しない
        if (this.searchState.isEditingRule() === true) {
            return;
        }

        // 検索 or 時刻ルール新規作成
        try {
            const pageInfo: PageInfo = {
                isTimeSpecification: this.searchState.isTimeSpecification,
                searchOption: cloneDeep(this.searchState.searchOption),
                timeReserveOption: cloneDeep(this.searchState.timeReserveOption),
                reserveOption: cloneDeep(this.searchState.reserveOption),
                saveOption: cloneDeep(this.searchState.saveOption),
                encodeOption: cloneDeep(this.searchState.encodeOption),
                isSearched: this.searchState.isTimeSpecification !== true && this.searchState.getSearchResult() !== null,
                genreSelect: this.searchState.genreSelect,
            };
            this.scrollState.saveScrollData(pageInfo);
        } catch (err) {
            console.error(err);
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.searchState.clear();
        this.isVisible = false;
        this.isShow = false;

        this.$nextTick(async () => {
            let ruleId: apid.RuleId | null = null;
            let isQuerySearch: boolean = false;

            this.isShow = true;

            // init
            try {
                if (typeof this.$route.query.rule !== 'undefined' && this.$route.query.rule !== null) {
                    // ルール編集の場合
                    ruleId = parseInt(this.$route.query.rule as string, 10);

                    await this.searchState.init(ruleId);
                } else {
                    await this.searchState.init();

                    // query による検索であれば値をセットする
                    const queryOption: QuerySearchOption = {};
                    if (typeof this.$route.query.keyword === 'string') {
                        queryOption.keyword = this.$route.query.keyword;
                    }
                    if (typeof this.$route.query.channelId === 'string') {
                        queryOption.channelId = parseInt(this.$route.query.channelId, 10);
                    }
                    if (typeof this.$route.query.genre === 'string') {
                        queryOption.genre = parseInt(this.$route.query.genre, 10);
                    }
                    if (typeof this.$route.query.subGenre === 'string') {
                        queryOption.subGenre = parseInt(this.$route.query.subGenre, 10);
                    }

                    if (Object.keys(queryOption).length > 0) {
                        this.searchState.setQueryOption(queryOption);
                        isQuerySearch = true;
                    }
                }
            } catch (err) {
                this.snackbarState.open({
                    color: 'error',
                    text: '初期化失敗',
                });
                console.error(err);
            }

            // ページ情報の復元が必要か?
            if (this.scrollState.isNeedRestoreHistory === true) {
                if (ruleId !== null) {
                    // 履歴ページかつルール編集
                    if (this.searchState.isTimeSpecification === true) {
                        // 時刻ルール
                        await this.searchState.fetchRuleReserves().catch(err => {
                            console.error(err);
                            this.snackbarState.open({
                                color: 'error',
                                text: '予約情報取得に失敗',
                            });
                        });
                    } else {
                        // EPGルール
                        await this.search(false).catch(err => {
                            console.error(err);
                        });
                    }
                } else {
                    // ページ情報復元
                    const pageInfo = this.scrollState.getScrollData<PageInfo>();
                    if (pageInfo !== null) {
                        this.searchState.isTimeSpecification = pageInfo.isTimeSpecification;
                        this.searchState.searchOption = cloneDeep(pageInfo.searchOption);
                        this.searchState.timeReserveOption = cloneDeep(pageInfo.timeReserveOption);
                        this.searchState.reserveOption = cloneDeep(pageInfo.reserveOption);
                        this.searchState.saveOption = cloneDeep(pageInfo.saveOption);
                        this.searchState.encodeOption = cloneDeep(pageInfo.encodeOption);
                        this.searchState.genreSelect = pageInfo.genreSelect;

                        if (pageInfo.isSearched === true) {
                            await this.search(false).catch(err => {
                                console.error(err);
                            });
                        }
                    }
                }
            } else {
                // 新規ページかつルール編集
                if (ruleId !== null) {
                    if (this.searchState.isTimeSpecification === true) {
                        // 時刻ルール
                        await this.searchState.fetchRuleReserves().catch(err => {
                            console.error(err);
                            this.snackbarState.open({
                                color: 'error',
                                text: '予約情報取得に失敗',
                            });
                        });
                    } else {
                        // EPGルール
                        await this.search(this.setting.getSavedValue().isEnableAutoScrollWhenEditingRule).catch(err => {
                            console.error(err);
                        });
                    }
                } else if (isQuerySearch) {
                    // query 検索
                    await this.search(true).catch(err => {
                        console.error(err);
                    });
                }
            }

            // Genre の表示が更新されないので cloneDeep で描画を更新させる
            this.$nextTick(() => {
                if (this.searchState.searchOption === null || typeof this.searchState.searchOption.genres === 'undefined') {
                    return;
                }

                this.searchState.searchOption.genres = cloneDeep(this.searchState.searchOption.genres);
            });

            // 初期化が完了してから描画させる
            this.isVisible = true;

            // データ取得完了を通知
            this.$nextTick(async () => {
                await this.scrollState.emitDoneGetData();
            });
        });
    }
}
</script>

<style lang="sass" scoped>
.app-content
    @media screen and (max-width: 940px)
        .fab-space
            width: 100%
            height: 80px
</style>
