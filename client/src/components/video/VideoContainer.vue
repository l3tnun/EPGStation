<template>
    <div class="video-container" ref="container">
        <div class="video-content" v-bind:class="{ 'is-ipad': isiPad === true }">
            <div v-if="isLoading === true" class="loading">
                <v-progress-circular :size="50" color="primary" indeterminate></v-progress-circular>
            </div>
            <div
                ref="videoControlWrap"
                class="video-control-wrap overflow-hidden"
                v-bind:class="{ 'hide-cursor': isHideCursor }"
                v-on:click="toggleControl"
                v-on:mousemove="mousemove"
                v-on:mouseleave="mouseleave"
            >
                <transition name="fade">
                    <div v-if="isShowControl === true">
                        <div class="d-flex center-buttons" v-on:click="stopPropagation">
                            <v-btn v-if="duration > 0" class="add-shadow mx-4" icon dark v-on:click="rewindTime(30)">
                                <v-icon dark>mdi-rewind-30</v-icon>
                            </v-btn>
                            <v-btn v-if="duration > 0" class="add-shadow mx-4" icon dark v-on:click="rewindTime(10)">
                                <v-icon dark>mdi-rewind-10</v-icon>
                            </v-btn>
                            <v-btn class="play-button add-shadow mx-4" icon dark v-on:click="togglePlay">
                                <v-icon v-if="isPause === true" dark>mdi-play</v-icon>
                                <v-icon v-else dark>mdi-pause</v-icon>
                            </v-btn>
                            <v-btn v-if="duration > 0" class="add-shadow mx-4" icon dark v-on:click="forwardTime(10)">
                                <v-icon dark>mdi-fast-forward-10</v-icon>
                            </v-btn>
                            <v-btn v-if="duration > 0" class="add-shadow mx-4" icon dark v-on:click="forwardTime(30)">
                                <v-icon dark>mdi-fast-forward-30</v-icon>
                            </v-btn>
                        </div>
                        <v-btn v-if="isEnabledRotation === true && isFullscreen === true" class="rotation-button" icon dark v-on:click="clickRotationButton">
                            <v-icon dark>mdi-screen-rotation</v-icon>
                        </v-btn>
                        <div v-if="duration > 0" class="d-flex flex-column align-center left-buttons" v-on:click="stopPropagation">
                            <v-btn class="add-shadow" icon dark v-on:click="speedUp">
                                <v-icon dark>mdi-plus-circle</v-icon>
                            </v-btn>
                            <v-btn class="add-shadow my-2" text dark v-on:click="resetSpeed">x{{ playbackRate.toFixed(1) }}</v-btn>
                            <v-btn class="add-shadow" icon dark v-on:click="speedDown">
                                <v-icon dark>mdi-minus-circle</v-icon>
                            </v-btn>
                        </div>
                        <div class="video-control">
                            <div class="content" v-on:click="stopPropagation">
                                <v-slider
                                    class="slider"
                                    v-model="currentTime"
                                    :max="duration"
                                    color="white"
                                    track-color="grey"
                                    :disabled="duration === 0"
                                    v-on:start="startChangeCurrentPosition"
                                    v-on:change="endChangeCurrentPosition"
                                    v-on:input="updateCurrentPosition"
                                ></v-slider>
                                <div class="d-flex align-center overflow-hidden mx-2">
                                    <v-btn class="play" icon dark v-on:click="togglePlay">
                                        <v-icon v-if="isPause === true">mdi-play</v-icon>
                                        <v-icon v-else>mdi-pause</v-icon>
                                    </v-btn>
                                    <div class="d-flex align-center volume-content">
                                        <v-btn icon dark v-on:click="switchMute">
                                            <v-icon v-if="volume > 0.4">mdi-volume-high</v-icon>
                                            <v-icon v-else-if="volume > 0.0">mdi-volume-medium</v-icon>
                                            <v-icon v-else>mdi-volume-off</v-icon>
                                        </v-btn>
                                        <v-slider
                                            class="slider"
                                            v-if="isHideAudioVolume === false"
                                            v-model="volume"
                                            min="0.0"
                                            max="1.0"
                                            step="0.1"
                                            color="white"
                                            track-color="grey"
                                            v-on:input="changeVolume"
                                            v-on:change="updateLastSeekTime"
                                        ></v-slider>
                                    </div>
                                    <div class="time Caption mx-2">
                                        <span>{{ currentTimeStr }}</span>
                                        <span class="mx-1">/</span>
                                        <span>{{ durationStr }}</span>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-btn
                                        v-if="isEnabledSubtitles === true"
                                        icon
                                        dark
                                        class="subtitle-icon"
                                        v-bind:class="{ disabled: isShowingSubtitle === false }"
                                        v-on:click="switchSubtitle"
                                    >
                                        <v-icon>mdi-subtitles</v-icon>
                                    </v-btn>
                                    <v-btn v-if="this.isEnabledPip === true" icon dark v-on:click="switchPip">
                                        <v-icon>mdi-picture-in-picture-bottom-right</v-icon>
                                    </v-btn>
                                    <v-btn icon dark v-on:click="switchFullScreen">
                                        <v-icon v-if="isFullscreen === false">mdi-fullscreen</v-icon>
                                        <v-icon v-else>mdi-fullscreen-exit</v-icon>
                                    </v-btn>
                                </div>
                            </div>
                        </div>
                    </div>
                </transition>
            </div>
            <NormalVideo
                v-if="videoParam.type == 'Normal'"
                ref="video"
                v-bind:videoSrc.sync="videoParam.src"
                v-on:timeupdate="onTimeupdate"
                v-on:waiting="onWaiting"
                v-on:loadeddata="onLoadeddata"
                v-on:canplay="onCanplay"
                v-on:ended="onEnded"
                v-on:play="onPlay"
                v-on:pause="onPause"
                v-on:ratechange="onChangePlaybackRate"
                v-on:volumechange="onVolumechange"
            ></NormalVideo>
            <LiveHLSVideo
                v-if="videoParam.type == 'LiveHLS'"
                ref="video"
                v-bind:channelId="videoParam.channelId"
                v-bind:mode="videoParam.mode"
                v-on:timeupdate="onTimeupdate"
                v-on:waiting="onWaiting"
                v-on:loadeddata="onLoadeddata"
                v-on:canplay="onCanplay"
                v-on:ended="onEnded"
                v-on:play="onPlay"
                v-on:pause="onPause"
                v-on:ratechange="onChangePlaybackRate"
                v-on:volumechange="onVolumechange"
            ></LiveHLSVideo>
            <RecordedStreamingVideo
                v-if="videoParam.type == 'RecordedStreaming'"
                ref="video"
                v-bind:recordedId="videoParam.recordedId"
                v-bind:videoFileId="videoParam.videoFileId"
                v-bind:streamingType="videoParam.streamingType"
                v-bind:mode="videoParam.mode"
                v-on:timeupdate="onTimeupdate"
                v-on:waiting="onWaiting"
                v-on:loadeddata="onLoadeddata"
                v-on:canplay="onCanplay"
                v-on:ended="onEnded"
                v-on:play="onPlay"
                v-on:pause="onPause"
                v-on:ratechange="onChangePlaybackRate"
                v-on:volumechange="onVolumechange"
            ></RecordedStreamingVideo>
            <RecordedHLSStreamingVideo
                v-if="videoParam.type == 'RecordedHLS'"
                ref="video"
                v-bind:recordedId="videoParam.recordedId"
                v-bind:videoFileId="videoParam.videoFileId"
                v-bind:mode="videoParam.mode"
                v-on:timeupdate="onTimeupdate"
                v-on:waiting="onWaiting"
                v-on:loadeddata="onLoadeddata"
                v-on:canplay="onCanplay"
                v-on:ended="onEnded"
                v-on:play="onPlay"
                v-on:pause="onPause"
                v-on:ratechange="onChangePlaybackRate"
                v-on:volumechange="onVolumechange"
            ></RecordedHLSStreamingVideo>
        </div>
    </div>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import LiveHLSVideo from '@/components/video/LiveHLSVideo.vue';
import NormalVideo from '@/components/video/NormalVideo.vue';
import RecordedHLSStreamingVideo from '@/components/video/RecordedHLSStreamingVideo.vue';
import RecordedStreamingVideo from '@/components/video/RecordedStreamingVideo.vue';
import * as VideoParam from '@/components/video/ViedoParam';
import UaUtil from '@/util/UaUtil';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';

interface SpeedItem {
    text: string;
    value: number;
}

@Component({
    components: {
        NormalVideo,
        LiveHLSVideo,
        RecordedStreamingVideo,
        RecordedHLSStreamingVideo,
    },
})
export default class VideoContainer extends Vue {
    @Prop({ required: true })
    public videoParam!: VideoParam.BaseVideoParam;

    @Prop({ required: false })
    public isEnabledSpeedControl: boolean | undefined; // 速度調整が有効か

    public isHideCursor: boolean = false;
    public currentTime: number = 0; // 動画再生位置 (秒)
    public duration: number = 0; // 動画終了長さ (秒)
    public volume: number = 1.0;
    public speed: number = 1.0;
    public isLoading: boolean = true;
    public isPause: boolean = true; // play ボタン用
    public isShowControl: boolean = false;
    public isHideAudioVolume: boolean = UaUtil.isMobile() || UaUtil.isiPadOS();
    public isEnabledPip: boolean = !!(document as any).pictureInPictureEnabled;
    public isFullscreen: boolean = this.checkFullscreen();
    public currentTimeStr: string = '--:--';
    public durationStr: string = '--:--';
    public playbackRate: number = 1.0;

    // 字幕状態
    public isEnabledSubtitles: boolean = false;
    public isShowingSubtitle: boolean = false;
    public isiPad: boolean = UaUtil.isiPadOS();

    private isFirstPlay: boolean = true;
    private isEnabledRotation: boolean = typeof window.screen.orientation !== 'undefined' && UaUtil.isMobile();
    private keyDwonListener = ((e: KeyboardEvent): void => {
        this.onKeyDown(e);
    }).bind(this);
    private fullScreenListener = ((): void => {
        this.fullscreenChange();
    }).bind(this);
    private hideControlTimer: number | undefined;

    // seek 時に使用する一時変数
    private needsReplay: boolean | null = null;
    private lastSeekedTime: number = 0; // 最後に slider を seek した時刻

    public created(): void {
        document.addEventListener('keydown', this.keyDwonListener, false);
        document.addEventListener('webkitfullscreenchange', this.fullScreenListener, false);
        document.addEventListener('mozfullscreenchange', this.fullScreenListener, false);
        document.addEventListener('MSFullscreenChange', this.fullScreenListener, false);
        document.addEventListener('fullscreenchange', this.fullScreenListener, false);
    }

    public beforeDestroy(): void {
        document.removeEventListener('keydown', this.keyDwonListener, false);
        document.removeEventListener('webkitfullscreenchange', this.fullScreenListener, false);
        document.removeEventListener('mozfullscreenchange', this.fullScreenListener, false);
        document.removeEventListener('MSFullscreenChange', this.fullScreenListener, false);
        document.removeEventListener('fullscreenchange', this.fullScreenListener, false);
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.isFirstPlay = true;
    }

    /**
     * on keydown
     * @param event: KeyboardEvent
     */
    private async onKeyDown(event: KeyboardEvent): Promise<void> {
        // space key 入力時に再生状態の反転
        if (event.key === ' ') {
            await this.togglePlay();

            if (typeof this.$refs.video !== 'undefined') {
                if ((this.$refs.video as BaseVideo).paused() === true) {
                    this.isShowControl = true;
                    this.isHideCursor = false;
                } else {
                    await Util.sleep(100);
                    this.isShowControl = false;
                    this.isHideCursor = true;
                    clearTimeout(this.hideControlTimer);
                }
            }
        }

        // switch mute
        if (event.key === 'm') {
            this.switchMute();
        }

        // switch fullscreen
        if (event.key === 'f') {
            this.switchFullScreen();
        }

        if (this.duration > 0) {
            // -10 seek
            if (event.key === 'ArrowLeft') {
                this.rewindTime(10);
            }

            // +10 seek
            if (event.key === 'ArrowRight') {
                this.forwardTime(10);
            }
        }
    }

    /**
     * fullscreen の状態が変化したときに呼ばれる
     */
    private fullscreenChange(): void {
        this.isFullscreen = this.checkFullscreen();
    }

    private checkFullscreen(): boolean {
        return (
            !!(
                (document as any).fullScreen ||
                (document as any).webkitIsFullScreen ||
                (document as any).mozFullScreen ||
                (document as any).msFullscreenElement ||
                (document as any).fullscreenElement
            ) ||
            (typeof this.$refs.video !== 'undefined' && !!(this.$refs.video as any).webkitDisplayingFullscreen)
        );
    }

    /**
     * mousemove 処理
     */
    public mousemove(e: MouseEvent): void {
        if (UaUtil.isAndroid() === true || typeof this.$refs.video === 'undefined' || (this.$refs.video as BaseVideo).paused() === true) {
            return;
        }

        this.isShowControl = true;
        this.isHideCursor = false;

        clearTimeout(this.hideControlTimer);
        if (e.target === this.$refs.videoControlWrap) {
            // video control 外
            this.hideControlTimer = setTimeout(() => {
                this.isShowControl = false;
                this.isHideCursor = true;
            }, 3000);
        }
    }

    /**
     * mouseleave 処理
     */
    private mouseleave(): void {
        //  再生中でない or 最後に slider を seek させてから 50ms 以上経過していない場合は無視する
        if (
            UaUtil.isAndroid() === true ||
            typeof this.$refs.video === 'undefined' ||
            (this.$refs.video as BaseVideo).paused() === true ||
            new Date().getTime() - this.lastSeekedTime < 50
        ) {
            return;
        }

        this.isShowControl = false;
        this.isHideCursor = false;
    }

    // 時刻更新
    public onTimeupdate(): void {
        const duration = this.getVideoDuration();
        this.duration = duration;
        this.currentTime = this.getVideoCurrentTime();
        this.updateTimeStr();
        this.updateSubtitleState();
    }

    /**
     * this.currentTimeStr, this.durationStr を更新する
     */
    private updateTimeStr(): void {
        const c = this.getTimeData(this.currentTime);
        const d = this.getTimeData(this.duration);

        if (d.h > 0) {
            this.currentTimeStr = `${this.zeroPadding(c.h)}:${this.zeroPadding(c.m)}:${this.zeroPadding(c.s)}`;
            this.durationStr = `${this.zeroPadding(d.h)}:${this.zeroPadding(d.m)}:${this.zeroPadding(d.s)}`;
        } else {
            this.currentTimeStr = `${this.zeroPadding(c.m)}:${this.zeroPadding(c.s)}`;
            this.durationStr = `${this.zeroPadding(d.m)}:${this.zeroPadding(d.s)}`;
        }
    }

    /**
     * @param time: number
     * @return { h: number; m: number; s: number }
     */
    private getTimeData(time: number): { h: number; m: number; s: number } {
        if (time === Infinity || isNaN(time)) {
            return {
                h: 0,
                m: 0,
                s: 0,
            };
        }

        time = Math.floor(time);

        return {
            h: (time / 3600) | 0,
            m: ((time % 3600) / 60) | 0,
            s: time % 60,
        };
    }

    /**
     * 0 埋め
     * @param num: number
     * @return string
     */
    private zeroPadding(num: number): string {
        return `0${num.toString(10)}`.slice(-2);
    }

    /**
     * 字幕の状態を更新する
     */
    protected updateSubtitleState(): void {
        if (typeof this.$refs.video !== 'undefined') {
            (this.$refs.video as BaseVideo).fixSubtitleState();
        }

        this.isEnabledSubtitles = typeof this.$refs.video !== 'undefined' && (this.$refs.video as BaseVideo).isEnabledSubtitles();
        this.isShowingSubtitle = typeof this.$refs.video !== 'undefined' && (this.$refs.video as BaseVideo).isShowingSubtitle();
    }

    // 読み込み中
    public onWaiting(): void {
        this.isLoading = true;
    }

    // 読み込み完了
    public onLoadeddata(): void {
        this.isLoading = false;
        this.updateSubtitleState();
    }

    // 再生可能
    public onCanplay(): void {
        this.isLoading = false;

        if (typeof this.$refs.video !== 'undefined' && (this.$refs.video as BaseVideo).paused() === true && new Date().getTime() - this.lastSeekedTime > 1000) {
            this.isShowControl = true;
            this.isHideCursor = false;
        }

        setTimeout(() => {
            if (this.isFirstPlay === true && typeof this.$refs.video !== 'undefined' && (this.$refs.video as BaseVideo).paused() === false) {
                this.isShowControl = false;
                this.isHideCursor = true;
            }
            this.isFirstPlay = false;
        }, 300);

        // set duration
        this.duration = this.getVideoDuration();

        // update time str
        this.updateTimeStr();

        this.updateSubtitleState();
    }

    // 終了
    public onEnded(): void {
        this.isLoading = false;
    }

    // 再生
    public onPlay(): void {
        this.isPause = false;
        this.updateSubtitleState();
    }

    // 停止
    public onPause(): void {
        this.isPause = true;
    }

    // 再生位置変更開始
    public startChangeCurrentPosition(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        // 後で再生状態を戻すために保存
        if ((this.$refs.video as BaseVideo).paused() === false) {
            // 再生中なら再生停止
            (this.$refs.video as BaseVideo).pause();
            this.needsReplay = true;
        }
    }

    // 再生位置変更終了
    public async endChangeCurrentPosition(time: number): Promise<void> {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        this.updateLastSeekTime();
        (this.$refs.video as BaseVideo).setCurrentTime(time);

        // シーク前に再生中であれば再開
        await Util.sleep(200);
        if (this.needsReplay === true) {
            await (this.$refs.video as BaseVideo).play().catch(err => {
                console.error(err);
            });
        }
        this.needsReplay = null;
    }

    // 再生位置更新時に呼ばれる
    public updateCurrentPosition(): void {
        this.updateTimeStr();
    }

    // 再生速度変更
    public onChangePlaybackRate(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        this.playbackRate = (this.$refs.video as BaseVideo).getPlaybackRate();
    }

    // 音量変更
    public onVolumechange(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        this.volume = (this.$refs.video as BaseVideo).getVolume();
    }

    // video control 表示切り替え
    public toggleControl(): void {
        // 最後に slider を seek させてから 50ms 以上経過していない場合は無視する
        if (new Date().getTime() - this.lastSeekedTime < 50) {
            return;
        }

        if (this.isShowControl === false) {
            clearTimeout(this.hideControlTimer);
            this.isHideCursor = false;
        } else if (typeof this.$refs.video !== 'undefined' && (this.$refs.video as BaseVideo).paused() === false) {
            this.isHideCursor = true;
        }
        this.isShowControl = !this.isShowControl;
    }

    // 再生状態切り替え
    public async togglePlay(): Promise<void> {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        if ((this.$refs.video as BaseVideo).paused() === true) {
            await (this.$refs.video as BaseVideo).play().catch(err => {
                console.error(err);
            });
        } else {
            (this.$refs.video as BaseVideo).pause();
        }
    }

    /**
     * 指定した時間だけ currentTime を戻す
     * @param time: number 戻す時間 (秒)
     */
    public rewindTime(time: number): void {
        if (time < 0 || typeof this.$refs.video === 'undefined') {
            return;
        }

        const newCurrentTime = this.currentTime - time;
        (this.$refs.video as BaseVideo).setCurrentTime(newCurrentTime < 0 ? 0 : newCurrentTime);
        this.updateLastSeekTime();
    }

    /**
     * 指定した時間だけ currentTime を進める
     * @param time: number 進める時間 (秒)
     */
    public forwardTime(time: number): void {
        if (time < 0 || typeof this.$refs.video === 'undefined') {
            return;
        }

        const newCurrentTime = this.currentTime + time;
        (this.$refs.video as BaseVideo).setCurrentTime(newCurrentTime > this.duration ? this.duration : newCurrentTime);
        this.updateLastSeekTime();
    }

    /**
     * 再生速度 up
     */
    public speedUp(): void {
        this.changePlaybackRate(Math.floor(this.playbackRate * 10 + 1) / 10);
    }

    /**
     * 再生速度を元に戻す
     */
    public resetSpeed(): void {
        this.changePlaybackRate(1.0);
    }

    /**
     * 再生速度 down
     */
    public speedDown(): void {
        this.changePlaybackRate(Math.floor(this.playbackRate * 10 - 1) / 10);
    }

    private changePlaybackRate(rate: number): void {
        if (typeof this.$refs.video === 'undefined' || rate < 0.1) {
            return;
        }

        (this.$refs.video as BaseVideo).setPlaybackRate(rate);
    }

    /**
     * 動画の長さを返す (秒)
     * @return number
     */
    private getVideoDuration(): number {
        return typeof this.$refs.video === 'undefined' ? 0 : (this.$refs.video as BaseVideo).getDuration();
    }

    /**
     * 動画の現在再生位置を返す (秒)
     * @return number
     */
    private getVideoCurrentTime(): number {
        return typeof this.$refs.video === 'undefined' ? 0 : (this.$refs.video as BaseVideo).getCurrentTime();
    }

    /**
     * mute 切り替え
     */
    public switchMute(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        (this.$refs.video as BaseVideo).switchMute();
    }

    /**
     * 音量変更
     */
    public changeVolume(volume: number): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        (this.$refs.video as BaseVideo).setVolume(volume);
    }

    /**
     * seek 時刻を更新する
     */
    public updateLastSeekTime(): void {
        this.lastSeekedTime = new Date().getTime();
    }

    // pip 切り替え
    public switchPip(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        try {
            if ((document as any).pictureInPictureElement === null) {
                (this.$refs.video as BaseVideo).requestPictureInPicture();
            } else {
                (document as any).exitPictureInPicture();
            }
        } catch (error) {
            console.error(error);
        }
    }

    /**
     * 字幕表示切り替え
     */
    public switchSubtitle(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        if ((this.$refs.video as BaseVideo).isShowingSubtitle() === true) {
            // 非表示
            (this.$refs.video as BaseVideo).disabledSubtitle();
        } else {
            // 表示
            (this.$refs.video as BaseVideo).showSubtitle();
        }

        this.updateSubtitleState();
    }

    // fullscreen 切り替え
    public async switchFullScreen(): Promise<void> {
        if (typeof this.$refs.container === 'undefined') {
            return;
        }

        if (this.isFullscreen === true) {
            // フルスクリーン終了
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if ((document as any).mozCancelFullScreen) {
                (document as any).mozCancelFullScreen();
            } else if ((document as any).webkitCancelFullScreen) {
                (document as any).webkitCancelFullScreen();
            } else if ((document as any).msExitFullscreen) {
                (document as any).msExitFullscreen();
            }
        } else {
            // フルスクリーンへ切り替え
            if (this.requestFullscreen(this.$refs.container as HTMLElement) === false && typeof this.$refs.video !== 'undefined') {
                (this.$refs.video as BaseVideo).requestFullscreen();
            }

            // 画面回転
            if (this.isLandscape() === false) {
                await this.switchRotation();
            }
        }
    }

    /**
     * full screen element
     * @param e: HTMLElement
     * @return boolean true: 成功, false: 失敗
     */
    private requestFullscreen(e: HTMLElement): boolean {
        /* tslint:disable:newline-before-return */
        if (UaUtil.isAndroid()) {
            e.requestFullscreen({ navigationUI: 'hide' });
            return true;
        } else if (e.requestFullscreen) {
            e.requestFullscreen();
            return true;
        } else if ((e as any).mozRequestFullScreen) {
            (e as any).mozRequestFullScreen();
            return true;
        } else if ((e as any).webkitRequestFullScreen) {
            (e as any).webkitRequestFullScreen();
            return true;
        } else if ((e as any).webkitEnterFullscreen) {
            (e as any).webkitEnterFullscreen();
            return true;
        } else if ((e as any).msRequestFullscreen) {
            (e as any).msRequestFullscreen();
            return true;
        }
        /* tslint:enable:newline-before-return */

        return false;
    }

    /**
     * full screen 時の画面回転状態を変更
     */
    private async switchRotation(): Promise<void> {
        if (this.isEnabledRotation === false) {
            return;
        }

        try {
            if (this.isLandscape()) {
                await (window.screen as any).orientation.lock('natural');
            } else {
                await (window.screen as any).orientation.lock('landscape');
            }
        } catch (err) {
            console.error(err);
        }
    }

    /**
     * 回転状態か？
     * @return boolean true で回転状態
     */
    private isLandscape(): boolean {
        return !this.isEnabledRotation || (window.screen as any).orientation.angle !== 0;
    }

    /**
     * 回転ボタンクリック時の動作
     * @param e: Event
     */
    public clickRotationButton(e: Event): void {
        e.stopPropagation();
        this.switchRotation();
    }

    public stopPropagation(e: Event): void {
        e.stopPropagation();
    }
}
</script>

<style lang="sass" scoped>
.fade-enter-active, .fade-leave-active
    transition: opacity .2s

.fade-enter, .fade-leave-to
    opacity: 0

.video-container
    position: relative
    max-width: 100%
    background: black

    &:fullscreen
        width: 100%
        height: 100%

    &::before
        content: ""
        display: block
        padding-top: 56.25%

    .add-shadow
        text-shadow: 0px 0px 10px black

    .video-content
        position: absolute
        top: 0
        left: 0
        width: 100%
        height: 100%

    .loading
        z-index: 2
        position: absolute
        height: 100%
        width: 100%
        display: flex
        flex-direction: column
        justify-content: center
        align-items: center

    .video-control-wrap
        z-index: 3
        position: relative
        height: 100%
        width: 100%

        &.hide-cursor
            cursor: none

        .center-buttons
            position: absolute
            top: 50%
            left: 50%
            transform: translateY(-50%) translateX(-50%)
            opacity: 0.8

        .rotation-button
            position: absolute
            top: 8px
            right: 16px

        .left-buttons
            position: absolute
            right: 6px
            top: 50%
            transform: translateY(-50%)
            opacity: 0.8

        .video-control
            height: 60px
            position: absolute
            bottom: 0
            width: 100%
            background: linear-gradient(to top, #000000d9, #0000)
            .content
                position: absolute
                width: 100%
                bottom: 0
                opacity: 0.8
                .volume-content
                    .slider
                        width: 64px
                .time
                    height: 36px
                    line-height: 36px
                    color: white
                    font-size: 12px
                    user-select: none

                .subtitle-icon.disabled
                    opacity: 0.3

        @media screen and (max-width: 420px)
            .left-buttons
                display: none !important

            .video-control
                .volume-content
                    .slider
                        display: none
                .play
                    display: none

    video
        z-index: 1
        position: absolute
        top: 0
        right: 0
        bottom: 0
        left: 0
        margin: auto
        width: 100%
        height: 100%

        &::cue
            color: white
            background-color: rgba(0, 0, 0, 0.6)

    .video-content
        &.is-ipad
            video::cue
                font-size: 26px
</style>

<style lang="sass">
.video-container
    .play-button
        .v-icon
            font-size: 60px
    .slider
        .v-input__slot
            margin: 0
        .v-messages
            display: none

.video-menu
    .v-text-field__details
        display: none
</style>
