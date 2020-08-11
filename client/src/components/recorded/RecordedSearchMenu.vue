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
                    <v-text-field
                        v-model="searchState.keyword"
                        label="キーワード"
                        clearable
                        v-on:keydown.enter="onSearch()"
                    ></v-text-field>
                    <v-select
                        v-model="searchState.ruleId"
                        :items="searchState.ruleItems"
                        label="ルール"
                        clearable
                        :menu-props="{ auto: true }"
                    ></v-select>
                    <v-select
                        v-model="searchState.channelId"
                        :items="searchState.channelItems"
                        label="放送局"
                        clearable
                        :menu-props="{ auto: true }"
                    ></v-select>
                    <v-select
                        v-model="searchState.genre"
                        :items="searchState.genreItems"
                        label="ジャンル"
                        clearable
                        :menu-props="{ auto: true }"
                    ></v-select>
                    <v-checkbox
                        v-model="searchState.isOnlyOriginalFile"
                        label="元ファイルを含む"
                        class="mt-2"
                    ></v-checkbox>
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
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IRecordedSearchState from '@/model/state/recorded/search/IRecordedSearchState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import { Component, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class RecordedSearchMenu extends Vue {
    public isOpen: boolean = false;
    public searchState: IRecordedSearchState = container.get<IRecordedSearchState>('IRecordedSearchState');

    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async () => {
        await this.searchState.update().catch(err => {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: '録画検索オプションの取得に失敗',
            });
        });
    }).bind(this);

    public created(): void {
        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
    }

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
            if (typeof this.searchState.ruleId !== 'undefined') {
                searchQuery.ruleId = this.searchState.ruleId;
            }
            if (typeof this.searchState.channelId !== 'undefined') {
                searchQuery.channelId = this.searchState.channelId;
            }
            if (typeof this.searchState.genre !== 'undefined') {
                searchQuery.genre = this.searchState.genre;
            }
            if (this.searchState.isOnlyOriginalFile === true) {
                searchQuery.isOnlyOriginalFile = true;
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

        this.searchState.fetchData().catch(err => {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: '録画検索オプションの取得に失敗',
            });
        });
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && oldState === false) {
            this.searchState.initValues();

            // query から値をセット
            if (typeof this.$route.query.keyword === 'string') {
                this.searchState.keyword = this.$route.query.keyword;
            }
            if (typeof this.$route.query.ruleId !== 'undefined') {
                this.searchState.ruleId = parseInt(this.$route.query.ruleId as string, 10);
            }
            if (typeof this.$route.query.channelId !== 'undefined') {
                this.searchState.channelId = parseInt(this.$route.query.channelId as string, 10);
            }
            if (typeof this.$route.query.genre !== 'undefined') {
                this.searchState.genre = parseInt(this.$route.query.genre as string, 10);
            }
            if (typeof this.$route.query.isOnlyOriginalFile !== 'undefined') {
                this.searchState.isOnlyOriginalFile =
                    (this.$route.query.isOnlyOriginalFile as any) === true ||
                    this.$route.query.isOnlyOriginalFile === 'true';
            }
        }
    }
}
</script>

<style lang="sass" scoped>
.menu-background
    position: fixed
    top: 0
    left: 0
    width: 100%
    height: 100vh
    z-index: 7 // vuetify アップデート毎に確認が必要
</style>

<style lang="sass">
.recorded-search
    .v-input__control
        .v-input__slot
            margin: 0 !important
        .v-messages
            display: none
</style>
