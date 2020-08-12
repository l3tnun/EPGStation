<template>
    <v-content>
        <TitleBar title="EPGStation"></TitleBar>
        <div class="app-content d-flex flex-column mx-auto">
            <transition name="page">
                <div v-if="isShow" class="dashboard pa-2">
                    <DashboardItem ref="recordingItem" title="録画中" v-on:scroll="onRecordingScroll">
                        <template v-slot:items>
                            <div></div>
                        </template>
                    </DashboardItem>
                    <DashboardItem ref="recordedItem" title="録画済み" v-on:scroll="onRecordedScroll">
                        <template v-slot:items>
                            <div></div>
                        </template>
                    </DashboardItem>
                    <DashboardItem ref="reserveItem" title="録画済み" v-on:scroll="onReserveScroll">
                        <template v-slot:items>
                            <div></div>
                        </template>
                    </DashboardItem>
                </div>
            </transition>
        </div>
        <Snackbar></Snackbar>
    </v-content>
</template>

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

<script lang="ts">
import DashboardItem from '@/components/dashboard/DashboardItem.vue';
import Snackbar from '@/components/snackbar/Snackbar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import UaUtil from '@/util/UaUtil';
import { Component, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';

interface ScrollData {
    recordingScroll: number;
    recordedScroll: number;
    reserveScroll: number;
}

@Component({
    components: {
        TitleBar,
        DashboardItem,
        Snackbar,
    },
})
export default class Main extends Vue {
    public isShow: boolean = false;

    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private recordingScroll: number = 0;
    private recordedScroll: number = 0;
    private reserveScroll: number = 0;

    public created(): void {
        if (UaUtil.isiOS() === true) {
            // html の class に guide を追加
            const element = document.getElementsByTagName('html')[0];
            element.classList.add('fix-address-bar');
        }
    }

    public beforeDestroy(): void {
        this.isShow = false;

        if (UaUtil.isiOS() === true) {
            // html の class から guide を削除
            const element = document.getElementsByTagName('html')[0];
            element.classList.remove('fix-address-bar');
        }
    }

    public onRecordingScroll(e: Event): void {
        this.recordingScroll = (<HTMLElement>e.target).scrollTop;
    }

    public onRecordedScroll(e: Event): void {
        this.recordedScroll = (<HTMLElement>e.target).scrollTop;
    }

    public onReserveScroll(e: Event): void {
        this.reserveScroll = (<HTMLElement>e.target).scrollTop;
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
    }
}
</script>

<style lang="sass" scoped>
// 横並び用設定
@media screen and (min-width: 800px)
    .app-content
        position: relative
        height: 100%
        max-width: 1500px

        .dashboard
            display: flex
            position: absolute
            top: 0
            height: 100%
            width: 100%
</style>
