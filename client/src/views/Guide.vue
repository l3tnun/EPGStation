<template>
    <v-content>
        <TitleBar
            :title="typeof $route.query.channelId === 'undefined' ? guideState.getTitle($route.query.type) : guideState.getSingleStationTitle()"
            :needsTitleClickEvent="true"
            v-on:click="onTitle"
        >
            <template v-slot:menu>
                <GuideTimeSelector v-if="isLoading === false"></GuideTimeSelector>
                <GuideMainMenu v-on:updatedgenre="onUpdateGenre"></GuideMainMenu>
            </template>
        </TitleBar>
        <div class="app-content guide" v-bind:class="{ 'is-dark': $vuetify.theme.dark === true }">
            <transition name="page">
                <div v-if="guideState.getChannelsLength() > 0" class="overflow-hidden d-flex flex-column" style="height: 100%">
                    <Loading v-if="isLoading === true"></Loading>
                    <div class="channel-wrap overflow-hidden" ref="channels">
                        <Channel></Channel>
                    </div>
                    <div class="child d-flex">
                        <div class="time-scale-wrap overflow-hidden" ref="times">
                            <TimeScale></TimeScale>
                        </div>
                        <GuideScroller class="program-wrap overflow-auto" v-on:scroll="onProgramScroll" ref="programs">
                            <template v-slot:content>
                                <div class="programs" v-bind:class="{ 'is-dark': $vuetify.theme.dark === true }" v-bind:style="programsStyle" ref="content">
                                    <TimeLine></TimeLine>
                                </div>
                            </template>
                        </GuideScroller>
                    </div>
                </div>
            </transition>
        </div>
        <ProgramDialog></ProgramDialog>
        <OnAirSelectStream :needsGotoGuideButton="true"></OnAirSelectStream>
        <GuideDaySelectDialog :isOpen.sync="isOpenDaySelectDialog"></GuideDaySelectDialog>
    </v-content>
</template>

<script lang="ts">
import Channel from '@/components/guide/Channel.vue';
import GuideDaySelectDialog from '@/components/guide/GuideDaySelectDialog.vue';
import GuideMainMenu from '@/components/guide/GuideMainMenu.vue';
import GuideScroller from '@/components/guide/GuideScroller.vue';
import GuideTimeSelector from '@/components/guide/GuideTimeSelector.vue';
import Loading from '@/components/guide/Loading.vue';
import ProgramDialog from '@/components/guide/ProgramDialog.vue';
import TimeLine from '@/components/guide/TimeLine.vue';
import TimeScale from '@/components/guide/TimeScale.vue';
import OnAirSelectStream from '@/components/onair/OnAirSelectStream.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IGuideState, { FetchGuideOption } from '@/model/state/guide/IGuideState';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { IGuideSizeSettingStorageModel } from '@/model/storage/guide/IGuideSizeSettingStorageModel';
import { ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import UaUtil from '@/util/UaUtil';
import Util from '@/util/Util';
import { debounce, throttle } from 'lodash';
import { Component, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
        GuideMainMenu,
        GuideTimeSelector,
        Loading,
        Channel,
        TimeScale,
        GuideScroller,
        TimeLine,
        ProgramDialog,
        OnAirSelectStream,
        GuideDaySelectDialog,
    },
})
export default class Guide extends Vue {
    public isLoading: boolean = true;
    public guideState: IGuideState = container.get<IGuideState>('IGuideState');
    public isOpenDaySelectDialog: boolean = false;

    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private settingValue: ISettingValue | null = null;
    private sizeSetting = container.get<IGuideSizeSettingStorageModel>('IGuideSizeSettingStorageModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = ((): void => {
        this.guideState.updateReserves();
    }).bind(this);

    private programBaseWidth: number = 140;
    private programBaseHeight: number = 180;

    private scrollCallback = throttle(() => {
        this.setDisplayRange();
        this.guideState.updateVisible();
    }, 10);

    private windowResizeCallback = debounce(() => {
        this.updateBaseSize();
        this.setDisplayRange();
        this.guideState.updateVisible();
    }, 100);

    private isiOS: boolean = false;

    get programsStyle(): any {
        const width = `calc(${this.guideState.getChannelsLength()} * var(--channel-width))`;
        const height = `calc(${this.guideState.getTimesLength()} * var(--timescale-height))`;

        return {
            'min-width': width,
            'max-width': width,
            width,
            'min-height': height,
            'max-height': height,
            height,
        };
    }

    public created(): void {
        this.settingValue = this.setting.getSavedValue();
        this.isiOS = UaUtil.isiOS();

        // リサイズイベント追加
        window.addEventListener('resize', this.windowResizeCallback, false);

        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);

        if (UaUtil.isiOS() === true) {
            // html の class に guide を追加
            const element = document.getElementsByTagName('html')[0];
            element.classList.add('fix-address-bar');
        }
    }

    public beforeDestroy(): void {
        // リサイズイベント追加
        window.removeEventListener('resize', this.windowResizeCallback, false);

        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);

        if (UaUtil.isiOS() === true) {
            // html の class から guide を削除
            const element = document.getElementsByTagName('html')[0];
            element.classList.remove('fix-address-bar');
        }
    }

    /**
     * タイトルクリック
     */
    public onTitle(): void {
        this.isOpenDaySelectDialog = true;
    }

    /**
     * ジャンル情報の更新
     */
    public onUpdateGenre(): void {
        this.isLoading = true;
        this.$nextTick(() => {
            this.guideState.updateGenre();
            this.isLoading = false;
        });
    }

    /**
     * 番組表スクロールイベント
     */
    public onProgramScroll(e: Event): void {
        if (typeof this.$refs.channels === 'undefined' || typeof this.$refs.times === 'undefined') {
            return;
        }

        const element = e.target as HTMLElement;
        (this.$refs.channels as HTMLElement).scrollLeft = element.scrollLeft;
        (this.$refs.times as HTMLElement).scrollTop = element.scrollTop;

        // スクロールバーサイズ
        const scrollBarLeft = element.offsetWidth - element.clientWidth;
        const scrollBarTop = element.offsetHeight - element.clientHeight;

        // iOS 端末で scroll 値がマイナス or 要素より大きい場合に描画を更新するとブルブルすためスクロール値を見る
        if (
            this.isiOS === false ||
            (element.scrollLeft >= 0 &&
                element.scrollTop >= 0 &&
                element.scrollLeft <= this.programBaseWidth * this.guideState.getChannelsLength() - element.offsetWidth + scrollBarLeft &&
                element.scrollTop <= this.programBaseHeight * this.guideState.getTimesLength() - element.offsetHeight + scrollBarTop)
        ) {
            this.scrollCallback();
        }
    }

    /**
     * ページ更新時に呼ばれる
     */
    public beforeRouteUpdate(to: Route, from: Route, next: () => void): void {
        this.saveScrollPosition();
        next();
    }

    /**
     * ページ離脱時に呼ばれる
     */
    public beforeRouteLeave(to: Route, from: Route, next: () => void): void {
        this.saveScrollPosition();
        next();
    }

    /**
     * スクロール位置を記録する
     */
    private saveScrollPosition(): void {
        if (typeof this.$refs.programs === 'undefined') {
            return;
        }

        try {
            this.scrollState.saveScrollData({
                x: (this.$refs.programs as GuideScroller).$el.scrollLeft,
                y: (this.$refs.programs as GuideScroller).$el.scrollTop,
            });
        } catch (err) {
            console.error(err);
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.isLoading = true;
        this.guideState.clearDate();
        this.$nextTick(async () => {
            this.setSizeSetting();
            this.updateBaseSize();
            // 番組表データ取得
            try {
                await this.guideState.fetchGuide(this.createFetchGuideOption());
            } catch (err) {
                this.isLoading = false;
                this.snackbarState.open({
                    text: '番組表情報の取得に失敗しました',
                    color: 'error',
                });
                console.error(err);

                // データ取得完了を通知
                await this.scrollState.emitDoneGetData();

                return;
            }

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();

            if (typeof this.$refs.programs !== 'undefined') {
                this.setDisplayRange();
                this.guideState.createProgramDoms(typeof this.$route.query.channelId !== 'undefined');

                if (typeof this.$refs.content !== 'undefined') {
                    // スクロール位置復元
                    if (this.scrollState.isNeedRestoreHistory === true) {
                        const position = this.scrollState.getScrollData<{ x: number; y: number }>();
                        if (position !== null) {
                            (this.$refs.programs as GuideScroller).$el.scrollLeft = position.x;
                            (this.$refs.programs as GuideScroller).$el.scrollTop = position.y;
                        }
                        this.scrollState.isNeedRestoreHistory = false;
                    } else {
                        // スクロール位置初期化
                        (this.$refs.programs as GuideScroller).$el.scrollLeft = 0;
                        (this.$refs.programs as GuideScroller).$el.scrollTop = 0;
                        if (typeof this.$refs.channels !== 'undefined' && typeof this.$refs.times !== 'undefined') {
                            (this.$refs.channels as HTMLElement).scrollLeft = 0;
                            (this.$refs.times as HTMLElement).scrollTop = 0;
                        }
                    }

                    // 時刻線要素を退避
                    const timeline = (this.$refs.content as HTMLElement).getElementsByClassName('time-line')[0];

                    // 追加する前に前回の子要素を削除
                    while ((this.$refs.content as HTMLElement).firstChild) {
                        const firstChild = (this.$refs.content as HTMLElement).firstChild;
                        if (firstChild !== null) {
                            (this.$refs.content as HTMLElement).removeChild(firstChild);
                        }
                    }

                    // 時刻線要素を元に戻す
                    (this.$refs.content as HTMLElement).appendChild(timeline);

                    await Util.sleep(100);
                    const programDoms = this.guideState.getProgramDoms();
                    const domsLength = programDoms.length;
                    for (let i = 0; i < domsLength; i++) {
                        (this.$refs.content as HTMLElement).appendChild(programDoms[i].element);
                        if (i % 500 === 0) {
                            await Util.sleep(1);
                        }
                    }

                    this.guideState.updateVisible();
                }
            }

            this.$nextTick(() => {
                this.isLoading = false;
            });
        });
    }

    /**
     * 各種サイズ設定を行う
     */
    private setSizeSetting(): void {
        const sizeValue = this.sizeSetting.getSavedValue();
        this.setCssVariable('--channel-tablet-height', `${sizeValue.tablet.channelHeight}px`);
        this.setCssVariable('--channel-tablet-width', `${sizeValue.tablet.channelWidth}px`);
        this.setCssVariable('--channel-tablet-fontsize', `${sizeValue.tablet.channelFontsize}px`);
        this.setCssVariable('--timescale-tablet-height', `${sizeValue.tablet.timescaleHeight}px`);
        this.setCssVariable('--timescale-tablet-width', `${sizeValue.tablet.timescaleWidth}px`);
        this.setCssVariable('--timescale-tablet-fontsize', `${sizeValue.tablet.timescaleFontsize}px`);
        this.setCssVariable('--program-tablet-fontsize', `${sizeValue.tablet.programFontSize}pt`);

        this.setCssVariable('--channel-mobile-height', `${sizeValue.mobile.channelHeight}px`);
        this.setCssVariable('--channel-mobile-width', `${sizeValue.mobile.channelWidth}px`);
        this.setCssVariable('--channel-mobile-fontsize', `${sizeValue.mobile.channelFontsize}px`);
        this.setCssVariable('--timescale-mobile-height', `${sizeValue.mobile.timescaleHeight}px`);
        this.setCssVariable('--timescale-mobile-width', `${sizeValue.mobile.timescaleWidth}px`);
        this.setCssVariable('--timescale-mobile-fontsize', `${sizeValue.mobile.timescaleFontsize}px`);
        this.setCssVariable('--program-mobile-fontsize', `${sizeValue.mobile.programFontSize}pt`);
    }

    /**
     * set css variables
     * @param name
     * @param value
     */
    private setCssVariable(name: string, value: string): void {
        const element = document.querySelector('.app-content.guide');
        if (element === null) {
            return;
        }
        (element as HTMLElement).style.setProperty(name, value);
    }

    /**
     * programBaseWidth, programBaseHeight の更新
     */
    private updateBaseSize(): void {
        this.programBaseWidth = this.getCssVariable('--channel-width');
        this.programBaseHeight = this.getCssVariable('--timescale-height');
    }

    /**
     * get CSS Variables
     * @param name
     * @return number
     */
    private getCssVariable(name: string): number {
        const element = document.querySelector('.app-content.guide');
        if (element === null) {
            return 0;
        }
        const style = window.getComputedStyle(element);

        const result = parseInt(style.getPropertyValue(name).trim().replace('px', ''), 10);

        return isNaN(result) === true ? 0 : result;
    }

    /**
     * FetchGuideOption を生成する
     * @return FetchGuideOption
     */
    private createFetchGuideOption(): FetchGuideOption {
        if (this.settingValue === null) {
            throw new Error('SettingValueIsNull');
        }

        const result: FetchGuideOption = {
            length: this.settingValue.guideLength,
            isHalfWidth: this.settingValue.isHalfWidthDisplayed,
        };

        if (typeof this.$route.query.type !== 'undefined') {
            result.type = this.$route.query.type as any;
        }

        if (typeof this.$route.query.time !== 'undefined') {
            result.time = this.$route.query.time as any;
        }

        if (typeof this.$route.query.channelId !== 'undefined') {
            result.channelId = parseInt(this.$route.query.channelId as any, 10);
        }

        return result;
    }

    private setDisplayRange(): void {
        this.guideState.setDisplayRange({
            baseWidth: this.programBaseWidth,
            baseHeight: this.programBaseHeight,
            maxWidth: ((this.$refs.programs as GuideScroller).$el as HTMLElement).offsetWidth,
            maxHeight: ((this.$refs.programs as GuideScroller).$el as HTMLElement).offsetHeight,
            offsetWidth: (this.$refs.programs as GuideScroller).$el.scrollLeft,
            offsetHeight: (this.$refs.programs as GuideScroller).$el.scrollTop,
        });
    }
}
</script>

<style lang="sass" scoped>
.app-content
    position: relative
    height: 100%
    &.is-dark
        background-color: #1E1E1E

    .channel-wrap
        width: 100%

    .child
        position: absolute
        top: var(--channel-height)
        height: calc(100% - var(--channel-height))
        width: 100%

        .program-wrap
            overflow: hidden
            width: calc(100% - var(--timescale-width))
</style>

<style lang="sass">
$window-width: 600px

.app-content.guide
    /**
     * タブレット用設定
     */
    --channel-tablet-height: 30px
    --channel-tablet-width: 140px
    --channel-tablet-fontsize: 14px

    --timescale-tablet-height: 180px
    --timescale-tablet-width: 30px
    --timescale-tablet-fontsize: 16px

    --program-tablet-fontsize: 10pt

    /**
     * モバイル用設定
     */
    --channel-mobile-height: 20px
    --channel-mobile-width: 100px
    --channel-mobile-fontsize: 12px

    --timescale-mobile-height: 120px
    --timescale-mobile-width: 20px
    --timescale-mobile-fontsize: 12px

    --program-mobile-fontsize: 7.5pt

    /* tablet */
    @media screen and (min-width: $window-width)
        --channel-height: var(--channel-tablet-height)
        --channel-width: var(--channel-tablet-width)
        --channel-fontsize: var(--channel-tablet-fontsize)
        --timescale-height: var(--timescale-tablet-height)
        --timescale-width: var(--timescale-tablet-width)
        --timescale-fontsize: var(--timescale-tablet-fontsize)
        --program-fontsize: var(--program-tablet-fontsize)

    /* mobile*/
    @media screen and (max-width: $window-width)
        --channel-height: var(--channel-mobile-height)
        --channel-width: var(--channel-mobile-width)
        --channel-fontsize: var(--channel-mobile-fontsize)
        --timescale-height: var(--timescale-mobile-height)
        --timescale-width: var(--timescale-mobile-width)
        --timescale-fontsize: var(--timescale-mobile-fontsize)
        --program-fontsize: var(--program-mobile-fontsize)


    .programs
        position: relative
        .item
            position: absolute
            max-width: var(--channel-width)
            min-width: var(--channel-width)
            width: var(--channel-width)
            font-size: var(--program-fontsize)
            position: absolute
            overflow: hidden
            box-sizing: border-box
            margin: 0
            padding: 0
            cursor: pointer
            border: 1px solid #ccc
            color: black

            &.hidden
                display: none

            .name
                font-weight: bold
            > div
                pointer-events: none
            &.reserve
                border: 4px solid red !important
            &.hide
                background-color: #f8f8f8
                color: #888
            &.conflict
                background-color: #fffd6b
                border: 4px solid red !important
                border-style: dashed !important
            &.skip
                background-color: #aaa
            &.overlap
                text-decoration: line-through
                background-color: #aaa

            .description
                white-space: pre-wrap

        &.is-dark
            .item
                border: 1px solid #443737
                color: #f3f3f3
                &.hide
                    background-color: #272121
                    color: #888
                &.conflict
                    background-color: #f6c90e
                &.skip
                    background-color: #717171
                &.overlap
                    background-color: #717171

/**
 * ジャンル別色
 */
.ctg-0
    background-color: #ABE6F6 // NEWS
.ctg-1
    background-color: #F3F8C3 // SPORTS
.ctg-2
    background-color: #AFD3F6 // INFORMATION
.ctg-3
    background-color: #F8C6CB // DRAMA
.ctg-4
    background-color: #D9EFA8 // MUSIC
.ctg-5
    background-color: #EBCCF0 // VARIETY
.ctg-6
    background-color: #FBE0B9 // CINEMA
.ctg-7
    background-color: #FCD1DF // ANIME
.ctg-8
    background-color: #AEB9F9 // DOCUMENTARY
.ctg-9
    background-color: #EAFFD1 // STAGE
.ctg-10
    background-color: #B7E3B8 // HOBBY
.ctg-11
    background-color: #C3F0EC // WELFARE
.ctg-12
    background-color: #FFFFFF // RESERVE1
.ctg-13
    background-color: #FFFFFF // RESERVE2
.ctg-14
    background-color: #FFFFFF // EXPAND
.ctg-15
    background-color: #FFFFFF // ETC
.ctg-empty
    background-color: #FFFFFF // empty

/**
 * ジャンル別色 (ダークテーマ)
 */
.is-dark
    .ctg-0
        background-color: #40b6bd // NEWS
    .ctg-1
        background-color: #97a039 // SPORTS
    .ctg-2
        background-color: #59b1c7 // INFORMATION
    .ctg-3
        background-color: #d88686 // DRAMA
    .ctg-4
        background-color: #7fa534 // MUSIC
    .ctg-5
        background-color: #cf56a1 // VARIETY
    .ctg-6
        background-color: #d85b2a // CINEMA
    .ctg-7
        background-color: #eb8242 // ANIME
    .ctg-8
        background-color: #515585 // DOCUMENTARY
    .ctg-9
        background-color: #83a993 // STAGE
    .ctg-10
        background-color: #2c7873 // HOBBY
    .ctg-11
        background-color: #46b3e6 // WELFARE
    .ctg-12
        background-color: #445165 // RESERVE1
    .ctg-13
        background-color: #445165 // RESERVE2
    .ctg-14
        background-color: #445165 // EXPAND
    .ctg-15
        background-color: #445165 // ETC
    .ctg-empty
        background-color: #445165 // empty
</style>
