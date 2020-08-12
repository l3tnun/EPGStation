<template>
    <v-content>
        <TitleBar title="EPGStation"></TitleBar>
        <div class="app-content d-flex flex-column mx-auto">
            <transition name="page">
                <div v-if="isShow" class="dashboard">
                    <DashboardItem ref="recordingItem" :title="recordingTitle" v-on:scroll="onRecordingScroll">
                        <template v-slot:items>
                            <div class="px-2">
                                <div v-for="r in recordingState.getRecorded()" v-bind:key="r.recordedItem.id">
                                    <RecordedsmallCard
                                        :item="r"
                                        v-on:detail="gotoRecordedDetail"
                                        v-on:stopEncode="stopEncode"
                                        :noThumbnail="true"
                                    ></RecordedsmallCard>
                                </div>
                            </div>
                        </template>
                    </DashboardItem>
                    <DashboardItem ref="recordedItem" :title="recordedTitle" v-on:scroll="onRecordedScroll">
                        <template v-slot:items>
                            <div class="px-2">
                                <div v-for="r in recordedState.getRecorded()" v-bind:key="r.recordedItem.id">
                                    <RecordedsmallCard
                                        :item="r"
                                        v-on:detail="gotoRecordedDetail"
                                        v-on:stopEncode="stopEncode"
                                    ></RecordedsmallCard>
                                </div>
                            </div>
                        </template>
                    </DashboardItem>
                    <DashboardItem ref="reserveItem" :title="reserveTitle" v-on:scroll="onReserveScroll">
                        <template v-slot:items>
                            <div>
                                <ReservesCard :reserves="reservesState.getReserves()" :flat="true"></ReservesCard>
                            </div>
                        </template>
                    </DashboardItem>
                </div>
            </transition>
        </div>
        <Snackbar></Snackbar>
    </v-content>
</template>

<script lang="ts">
import DashboardItem from '@/components/dashboard/DashboardItem.vue';
import RecordedsmallCard from '@/components/recorded/RecordedSmallCard.vue';
import ReservesCard from '@/components/reserves/ReservesCard.vue';
import Snackbar from '@/components/snackbar/Snackbar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IRecordedState from '@/model/state/recorded/IRecordedState';
import IRecordingState from '@/model/state/recording/IRecordingState';
import IReservesState from '@/model/state/reserve/IReservesState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import ISettingStorageModel, { ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import UaUtil from '@/util/UaUtil';
import Util from '@/util/Util';
import { Component, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';
import * as apid from '../../../api';

interface ScrollData {
    recordingScroll: number;
    recordedScroll: number;
    reserveScroll: number;
}

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
        DashboardItem,
        ReservesCard,
        RecordedsmallCard,
        Snackbar,
    },
})
export default class Main extends Vue {
    public isShow: boolean = false;
    public recordedState: IRecordedState = container.get<IRecordedState>('IRecordedState');
    public recordingState: IRecordingState = container.get<IRecordingState>('IRecordingState');
    public reservesState: IReservesState = container.get<IReservesState>('IReservesState');

    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private settingValue: ISettingValue | null = null;
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async () => {
        await this.recordingState.fetchData(this.createFetchRecordingDataOption());
        await this.recordedState.fetchData(this.createFetchRecordedDataOption());
        await this.reservesState.fetchData(this.createFetchReserveDataOption());
    }).bind(this);
    private recordingScroll: number = 0;
    private recordedScroll: number = 0;
    private reserveScroll: number = 0;

    get recordingTitle(): string {
        return `録画中 ${this.recordingState.getRecorded().length}/${this.recordingState.getTotal()}`;
    }

    get recordedTitle(): string {
        return `録画済み ${this.recordedState.getRecorded().length}/${this.recordedState.getTotal()}`;
    }

    get reserveTitle(): string {
        return `予約 ${this.reservesState.getReserves().length}/${this.reservesState.getTotal()}`;
    }

    public created(): void {
        if (UaUtil.isiOS() === true) {
            // html の class に guide を追加
            const element = document.getElementsByTagName('html')[0];
            element.classList.add('fix-address-bar');
        }

        this.settingValue = this.setting.getSavedValue();

        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);

        this.isShow = false;

        if (UaUtil.isiOS() === true) {
            // html の class から guide を削除
            const element = document.getElementsByTagName('html')[0];
            element.classList.remove('fix-address-bar');
        }
    }

    /**
     * 録画中スクロール
     * @param e: Event
     */
    public onRecordingScroll(e: Event): void {
        this.recordingScroll = (<HTMLElement>e.target).scrollTop;
    }

    /**
     * 録画済みスクロール
     * @param e: Event
     */
    public onRecordedScroll(e: Event): void {
        this.recordedScroll = (<HTMLElement>e.target).scrollTop;
    }

    /**
     * 予約スクロール
     * @param e: Event
     */
    public onReserveScroll(e: Event): void {
        this.reserveScroll = (<HTMLElement>e.target).scrollTop;
    }

    /**
     * 録画詳細へ飛ぶ
     */
    public gotoRecordedDetail(recordedId: apid.RecordedId): void {
        Util.move(this.$router, { path: `/recorded/detail/${recordedId.toString(10)}` });
    }

    /**
     * エンコード停止
     * @param recordedId: apid.RecordedId
     */
    public async stopEncode(recordedId: apid.RecordedId): Promise<void> {
        try {
            await this.recordedState.stopEncode(recordedId);
            this.snackbarState.open({
                color: 'success',
                text: 'エンコード停止',
            });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'エンコード停止に失敗',
            });
        }
    }

    /**
     * ページ更新時に呼ばれる
     */
    public beforeRouteUpdate(to: Route, from: Route, next: () => void): void {
        console.log('call beforeRouteUpdate');
        this.saveScrollPosition();
        next();
    }

    /**
     * ページ離脱時に呼ばれる
     */
    public beforeRouteLeave(to: Route, from: Route, next: () => void): void {
        console.log('call beforeRouteLeave');
        this.saveScrollPosition();
        next();
    }

    /**
     * スクロール位置を記録する
     */
    private saveScrollPosition(): void {
        try {
            this.scrollState.saveScrollData({
                recordingScroll: this.recordingScroll,
                recordedScroll: this.recordedScroll,
                reserveScroll: this.reserveScroll,
            });
        } catch (err) {
            console.error(err);
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.$nextTick(() => {
            this.recordingState.clearData();
            this.recordedState.clearData();
            this.reservesState.clearDate();

            this.$nextTick(async () => {
                await this.recordingState.fetchData(this.createFetchRecordingDataOption()).catch(err => {
                    this.snackbarState.open({
                        color: 'error',
                        text: '録画中データ取得に失敗',
                    });
                    console.error(err);
                });
                await this.recordedState.fetchData(this.createFetchRecordedDataOption()).catch(err => {
                    this.snackbarState.open({
                        color: 'error',
                        text: '録画済みデータ取得に失敗',
                    });
                    console.error(err);
                });
                await this.reservesState.fetchData(this.createFetchReserveDataOption()).catch(err => {
                    this.snackbarState.open({
                        color: 'error',
                        text: '予約データ取得に失敗',
                    });
                    console.error(err);
                });

                this.isShow = true;

                this.$nextTick(async () => {
                    // スクロール位置復元を許可
                    await this.scrollState.emitDoneGetData();

                    if (this.scrollState.isNeedRestoreHistory === true) {
                        // スクロール位置復元
                        const position = this.scrollState.getScrollData<ScrollData>();
                        if (position !== null) {
                            if (typeof this.$refs.recordingItem !== 'undefined') {
                                (<DashboardItem>this.$refs.recordingItem).setScrollTop(position.recordingScroll);
                            }
                            if (typeof this.$refs.recordedItem !== 'undefined') {
                                (<DashboardItem>this.$refs.recordedItem).setScrollTop(position.recordedScroll);
                            }
                            if (typeof this.$refs.reserveItem !== 'undefined') {
                                (<DashboardItem>this.$refs.reserveItem).setScrollTop(position.reserveScroll);
                            }
                        }

                        this.scrollState.isNeedRestoreHistory = false;
                    }
                });
            });
        });
    }

    /**
     * 録画中番組データ取得時のオプションを生成する
     * @return GetReserveOption
     */
    private createFetchRecordingDataOption(): apid.GetRecordedOption {
        if (this.settingValue === null) {
            throw new Error('SettingValueIsNull');
        }

        return {
            isHalfWidth: this.settingValue.isRecordingHalfWidthDisplayed,
            offset: (Util.getPageNum(this.$route) - 1) * this.settingValue.recordingLength,
            limit: this.settingValue.recordingLength,
        };
    }

    /**
     * 録画データ取得時のオプションを生成する
     * @return GetReserveOption
     */
    private createFetchRecordedDataOption(): apid.GetRecordedOption {
        if (this.settingValue === null) {
            throw new Error('SettingValueIsNull');
        }

        const option: apid.GetRecordedOption = {
            isHalfWidth: this.settingValue.isRecordedHalfWidthDisplayed,
            offset: (Util.getPageNum(this.$route) - 1) * this.settingValue.recordedLength,
            limit: this.settingValue.recordedLength,
        };

        // query から読み取り
        if (typeof this.$route.query.keyword === 'string') {
            option.keyword = this.$route.query.keyword;
        }
        if (typeof this.$route.query.ruleId !== 'undefined') {
            option.ruleId = parseInt(this.$route.query.ruleId as string, 10);
        }
        if (typeof this.$route.query.channelId !== 'undefined') {
            option.channelId = parseInt(this.$route.query.channelId as string, 10);
        }
        if (typeof this.$route.query.genre !== 'undefined') {
            option.genre = parseInt(this.$route.query.genre as string, 10);
        }
        if (typeof this.$route.query.isOnlyOriginalFile !== 'undefined') {
            option.isOnlyOriginalFile =
                (this.$route.query.isOnlyOriginalFile as any) === true ||
                this.$route.query.isOnlyOriginalFile === 'true';
        }

        return option;
    }

    /**
     * 予約データ取得時のオプションを生成する
     * @return GetReserveOption
     */
    private createFetchReserveDataOption(): apid.GetReserveOption {
        if (this.settingValue === null) {
            throw new Error('SettingValueIsNull');
        }

        const type = this.$route.query.type;

        return {
            type:
                typeof type === 'undefined'
                    ? 'all'
                    : type === 'normal' || type === 'conflict' || type === 'overlap' || type === 'skip'
                    ? type
                    : 'normal',
            isHalfWidth: this.settingValue.isReservesHalfWidthDisplayed,
            offset: (Util.getPageNum(this.$route) - 1) * this.settingValue.reservesLength,
            limit: this.settingValue.reservesLength,
        };
    }
}
</script>

<style lang="sass" scoped>
// 横並び用設定
@media screen and (min-width: 800px)
    .app-content
        position: relative
        height: 100%
        max-width: 1800px

        .dashboard
            display: flex
            position: absolute
            top: 0
            height: 100%
            width: 100%

            .dash-board-item
                width: 33.3%
</style>
