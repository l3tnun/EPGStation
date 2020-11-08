<template>
    <v-content>
        <TitleBar title="設定"></TitleBar>
        <transition name="page">
            <div v-if="isShow" ref="appContent" class="app-content">
                <v-container>
                    <v-card class="mx-auto" max-width="800">
                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">全般</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">PWA</v-list-item-title>
                                        <v-list-item-subtitle>PWAを有効化する(※再読込後有効になります)</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isEnablePWA" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">ダークテーマ</v-list-item-title>
                                        <v-list-item-subtitle>ダークテーマを有効化する</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="isForceDarkTheme" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">半角表示</v-list-item-title>
                                        <v-list-item-subtitle>強制的に半角表示にする</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isHalfWidthDisplayed" value></v-switch>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">放映中</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">放送波種別表示</v-list-item-title>
                                        <v-list-item-subtitle>放送波毎にタブで分ける</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isOnAirTabListView" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-column">
                                    <div class="d-flex">
                                        <div>
                                            <v-list-item-title class="subtitle-1">視聴 URL Scheme</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                    </div>
                                    <v-text-field v-model="storageModel.tmp.onAirM2TSViewURLScheme" label="URL" clearable></v-text-field>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">番組表</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">描画設定</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="guideModeItems" v-model="storageModel.tmp.guideMode" class="guide-mode" :menu-props="{ auto: true }"></v-select>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">表示時間</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="guideLengthItems" v-model="storageModel.tmp.guideLength" class="guide-time" :menu-props="{ auto: true }"></v-select>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">放送波種別表示</v-list-item-title>
                                        <v-list-item-subtitle>ナビゲーションの表示を放送波別に分ける</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isEnableDisplayForEachBroadcastWave" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">検索時に放送局情報を含むか</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isIncludeChannelIdWhenSearching" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">検索時にジャンル情報を含むか</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isIncludeGenreWhenSearching" value></v-switch>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">予約</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">表示件数</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="reservesLengthItems" v-model="storageModel.tmp.reservesLength" class="guide-time" :menu-props="{ auto: true }"></v-select>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>
                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">録画中</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">表示件数</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="recordingLengthItems" v-model="storageModel.tmp.recordingLength" class="guide-time" :menu-props="{ auto: true }"></v-select>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">録画</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">表示件数</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="recordedLengthItems" v-model="storageModel.tmp.recordedLength" class="guide-time" :menu-props="{ auto: true }"></v-select>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">テーブル表示</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isShowTableMode" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">概要の代わりにドロップ情報を表示する</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isShowDropInfoInsteadOfDescription" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">web での再生を優先する</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isPreferredPlayingOnWeb" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-column">
                                    <div class="d-flex">
                                        <div>
                                            <v-list-item-title class="subtitle-1">視聴 URL Scheme</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-switch v-model="storageModel.tmp.shouldUseRecordedViewURLScheme" value></v-switch>
                                    </div>
                                    <v-text-field v-model="storageModel.tmp.recordedViewURLScheme" label="URL" clearable></v-text-field>
                                </div>
                                <div class="my-2 d-flex flex-column">
                                    <div class="d-flex">
                                        <div>
                                            <v-list-item-title class="subtitle-1">ダウンロード URL Scheme</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-switch v-model="storageModel.tmp.shouldUseRecordedDownloadURLScheme" value></v-switch>
                                    </div>
                                    <v-text-field v-model="storageModel.tmp.recordedDownloadURLScheme" label="URL" clearable></v-text-field>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">検索</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">最大表示件数</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="searchLengthItems" v-model="storageModel.tmp.searchLength" class="guide-time" :menu-props="{ auto: true }"></v-select>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">自動スクロール</v-list-item-title>
                                        <v-list-item-subtitle>ルール編集時に検索結果へ自動スクロールする</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isEnableAutoScrollWhenEditingRule" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">自動サブディレクトリ設定</v-list-item-title>
                                        <v-list-item-subtitle>ルール作成時にキーワードをサブディレクトリにコピーする</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isEnableCopyKeywordToDirectory" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">録画済み番組を排除</v-list-item-title>
                                        <v-list-item-subtitle>ルール作成時に録画済み番組を排除をチェックする</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isCheckAvoidDuplicate" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">エンコードの自動設定</v-list-item-title>
                                        <v-list-item-subtitle>ルール作成時にエンコード設定を自動で行う</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isEnableEncodingSettingWhenCreateRule" value></v-switch>
                                </div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">元ファイルの自動削除</v-list-item-title>
                                        <v-list-item-subtitle>ルール作成時に元ファイルの自動削除をチェックする</v-list-item-subtitle>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-switch v-model="storageModel.tmp.isCheckDeleteOriginalAfterEncode" value></v-switch>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-divider></v-divider>

                        <v-list-item three-line>
                            <v-list-item-content>
                                <div class="title">ルール</div>
                                <div class="my-2 d-flex flex-row align-center">
                                    <div>
                                        <v-list-item-title class="subtitle-1">表示件数</v-list-item-title>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-select :items="rulesLengthItems" v-model="storageModel.tmp.rulesLength" class="guide-time" :menu-props="{ auto: true }"></v-select>
                                </div>
                            </v-list-item-content>
                        </v-list-item>

                        <v-card-actions right>
                            <v-spacer></v-spacer>
                            <v-btn text v-on:click="reset">リセット</v-btn>
                            <v-btn text color="primary" v-on:click="save">保存</v-btn>
                        </v-card-actions>
                    </v-card>
                    <div style="visibility: hidden">dummy</div>
                </v-container>
            </div>
        </transition>
    </v-content>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import INavigationState from '@/model/state/navigation/INavigationState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel, GuideViewMode } from '@/model/storage/setting/ISettingStorageModel';
import { Component, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

interface GuideModeItem {
    text: string;
    value: GuideViewMode;
}

interface SelectItem {
    text: string;
    value: number;
}

@Component({
    components: {
        TitleBar,
    },
})
export default class Settings extends Vue {
    public isShow: boolean = false;
    public storageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');

    private navigationState: INavigationState = container.get<INavigationState>('INavigationState');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public readonly guideModeItems: GuideModeItem[] = [
        {
            text: '逐次',
            value: 'sequential',
        },
        {
            text: '最小',
            value: 'minimum',
        },
        {
            text: 'すべて',
            value: 'all',
        },
    ];

    public guideLengthItems: SelectItem[] = [];
    public reservesLengthItems: SelectItem[] = [];
    public recordingLengthItems: SelectItem[] = [];
    public recordedLengthItems: SelectItem[] = [];
    public searchLengthItems: SelectItem[] = [];
    public rulesLengthItems: SelectItem[] = [];

    get isForceDarkTheme(): boolean {
        return this.storageModel.tmp.isForceDarkTheme;
    }

    set isForceDarkTheme(value: boolean) {
        this.storageModel.tmp.isForceDarkTheme = value;
        this.$vuetify.theme.dark = value;
    }

    constructor() {
        super();

        for (let i = 1; i <= 24; i++) {
            this.guideLengthItems.push({
                text: i.toString(10),
                value: i,
            });
        }

        for (let i = 1; i <= 100; i++) {
            const item: SelectItem = {
                text: i.toString(10),
                value: i,
            };
            this.reservesLengthItems.push(item);
            this.recordingLengthItems.push(item);
            this.recordedLengthItems.push(item);
            this.rulesLengthItems.push(item);
        }

        for (let i = 50; i <= 300; i += 50) {
            const item: SelectItem = {
                text: i.toString(10),
                value: i,
            };
            this.searchLengthItems.push(item);
        }
    }

    public beforeDestroy(): void {
        this.isShow = false;
    }

    public destroyed(): void {
        // ページから移動するときに tmp をリセット
        this.storageModel.resetTmpValue();
        this.$vuetify.theme.dark = this.storageModel.tmp.isForceDarkTheme;
    }

    /**
     * setting の tmp をデフォルト値へリセットする
     */
    public reset(): void {
        this.storageModel.tmp = this.storageModel.getDefaultValue();
        this.$vuetify.theme.dark = this.storageModel.tmp.isForceDarkTheme;
    }

    /**
     * tmp の値を保存する
     */
    public save(): void {
        this.storageModel.save();
        this.navigationState.updateItems(this.$route);

        this.snackbarState.open({
            text: '保存されました',
            color: 'success',
        });
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.$nextTick(() => {
            this.isShow = true;

            this.$nextTick(async () => {
                // スクロール位置復元を許可
                await this.scrollState.emitDoneGetData();
            });
        });
    }
}
</script>

<style lang="sass" scoped>
.guide-mode
    max-width: 100px
.guide-time
    max-width: 70px
</style>

<style lang="sass">
// toggle switch の橋が途切れるため
.v-input--switch
    margin-right: 4px
    margin-top: 0 !important
    padding-top: 0 !important
    .v-input__slot
        margin-bottom: 0 !important
    .v-messages
        display: none
</style>
