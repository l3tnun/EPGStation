<template>
    <div class="video-container" ref="container">
        <div class="video-content">
            <div v-if="isLoading === true || videoSrc === null" class="loading">
                <v-progress-circular :size="50" color="primary" indeterminate></v-progress-circular>
            </div>
            <div class="video-control-wrap overflow-hidden" v-on:click="toggleControl">
                <transition name="fade">
                    <div v-if="isShowControl === true">
                        <div class="d-flex center-buttons" v-on:click="stopPropagation">
                            <v-btn v-if="isEnabledRewindForwardButtons === true" class="rewind mx-4" icon dark>
                                <v-icon dark>mdi-rewind-30</v-icon>
                            </v-btn>
                            <v-btn v-if="isEnabledRewindForwardButtons === true" class="rewind mx-4" icon dark>
                                <v-icon dark>mdi-rewind-10</v-icon>
                            </v-btn>
                            <v-btn class="play-button mx-4" icon dark v-on:click="togglePlay">
                                <v-icon v-if="isPause === true" dark>mdi-play</v-icon>
                                <v-icon v-else dark>mdi-pause</v-icon>
                            </v-btn>
                            <v-btn v-if="isEnabledRewindForwardButtons === true" class="forward mx-4" icon dark>
                                <v-icon dark>mdi-fast-forward-10</v-icon>
                            </v-btn>
                            <v-btn v-if="isEnabledRewindForwardButtons === true" class="forward mx-4" icon dark>
                                <v-icon dark>mdi-fast-forward-30</v-icon>
                            </v-btn>
                        </div>
                        <div class="video-control">
                            <div class="content" v-on:click="stopPropagation">
                                <v-slider
                                    class="slider"
                                    v-model="currentTime"
                                    :max="endTime"
                                    color="white"
                                    track-color="grey"
                                    v-on:start="startChangeCurrentPosition"
                                    v-on:change="endChangeCurrentPosition"
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
                                            v-model="volume"
                                            min="0.0"
                                            max="1.0"
                                            step="0.1"
                                            color="white"
                                            track-color="grey"
                                            v-on:input="changeVolume"
                                        ></v-slider>
                                    </div>
                                    <div class="time Caption mx-2">
                                        <span>00:00</span>
                                        <span class="mx-1">/</span>
                                        <span>00:00</span>
                                    </div>
                                    <v-spacer></v-spacer>
                                    <v-menu
                                        v-if="isEnabledSpeedControl === true"
                                        offset-y
                                        :close-on-content-click="false"
                                    >
                                        <template v-slot:activator="{ on, attrs }">
                                            <v-btn icon dark v-bind="attrs" v-on="on">
                                                <v-icon>mdi-play-speed</v-icon>
                                            </v-btn>
                                        </template>
                                        <v-card class="video-menu pa-2">
                                            <v-select v-model="speed" :items="speedItems" label="speed"></v-select>
                                        </v-card>
                                    </v-menu>
                                    <v-btn v-if="isEnabledSubtitles === true" icon dark>
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
            <Video
                v-if="videoSrc !== null"
                ref="video"
                v-bind:videoSrc.sync="videoSrc"
                v-on:timeupdate="onTimeupdate"
                v-on:waiting="onWaiting"
                v-on:loadeddata="onLoadeddata"
                v-on:canplay="onCanplay"
                v-on:ended="onEnded"
                v-on:play="onPlay"
                v-on:pause="onPause"
                v-on:volumechange="onVolumechange"
            ></Video>
        </div>
    </div>
</template>

<script lang="ts">
import Video from '@/components/video/Video.vue';
import UaUtil from '@/util/UaUtil';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';

interface SpeedItem {
    text: string;
    value: number;
}

@Component({
    components: {
        Video,
    },
})
export default class VideoContainer extends Vue {
    @Prop({ required: true })
    public videoSrc!: string | null;

    @Prop()
    public isEnabledRewindForwardButtons: boolean | undefined; // 戻る、進むボタンが有効か

    @Prop()
    public isEnabledSubtitles: boolean | undefined; // 字幕が有効か

    @Prop()
    public isEnabledSpeedControl: boolean | undefined; // 速度調整が有効か

    public speedItems: SpeedItem[] = [];
    public currentTime: number = 0; // 動画再生位置 (秒)
    public endTime: number = 0; // 動画終了長さ (秒)
    public volume: number = 1.0;
    public speed: number = 1.0;
    public isLoading: boolean = true;
    public isPause: boolean = true; // play ボタン用
    public isShowControl: boolean = false;
    public isEnabledPip: boolean;
    public isFullscreen: boolean = this.checkFullscreen();

    private isFirstPlay: boolean = true;
    private isEnabledRotation: boolean = typeof (<any>window.screen).orientation !== 'undefined' && UaUtil.isMobile();
    private fullScreenListener = (() => {
        this.fullscreenChange();
    }).bind(this);

    // seek 時に使用する一時変数
    private needsReplay: boolean | null = null;

    constructor() {
        super();

        this.isEnabledPip = !!(<any>document).pictureInPictureEnabled;
        for (let i = 5; i <= 20; i++) {
            const value = i / 10;

            this.speedItems.push({
                text: `x${value.toFixed(1)}`,
                value: value,
            });
        }
    }

    public created(): void {
        document.addEventListener('webkitfullscreenchange', this.fullScreenListener, false);
        document.addEventListener('mozfullscreenchange', this.fullScreenListener, false);
        document.addEventListener('MSFullscreenChange', this.fullScreenListener, false);
        document.addEventListener('fullscreenchange', this.fullScreenListener, false);
    }

    public beforeDestroy(): void {
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
     * fullscreen の状態が変化したときに呼ばれる
     */
    private fullscreenChange(): void {
        this.isFullscreen = this.checkFullscreen();
    }

    private checkFullscreen(): boolean {
        return (
            !!(
                (<any>document).fullScreen ||
                (<any>document).webkitIsFullScreen ||
                (<any>document).mozFullScreen ||
                (<any>document).msFullscreenElement ||
                (<any>document).fullscreenElement
            ) ||
            (typeof this.$refs.video !== 'undefined' && !!(<any>this.$refs.video).webkitDisplayingFullscreen)
        );
    }

    // 時刻更新
    public onTimeupdate(): void {
        const duration = this.getVideoDuration();
        this.endTime = duration;
        this.currentTime = this.getVideoCurrentTime();
    }

    // 読み込み中
    public onWaiting(): void {
        this.isLoading = true;
    }

    // 読み込み完了
    public onLoadeddata(): void {
        this.isLoading = false;
    }

    // 再生可能
    public onCanplay(): void {
        this.isLoading = false;

        if (typeof this.$refs.video !== 'undefined' && (<Video>this.$refs.video).paused() === true) {
            this.isShowControl = true;
        }

        setTimeout(() => {
            if (
                this.isFirstPlay === true &&
                typeof this.$refs.video !== 'undefined' &&
                (<Video>this.$refs.video).paused() === false
            ) {
                this.isShowControl = false;
            }
            this.isFirstPlay = false;
        }, 300);

        // set endTime
        this.endTime = this.getVideoDuration();
    }

    // 終了
    public onEnded(): void {
        this.isLoading = false;
    }

    // 再生
    public onPlay(): void {
        this.isPause = false;
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
        if ((<Video>this.$refs.video).paused() === false) {
            // 再生中なら再生停止
            (<Video>this.$refs.video).pause();
            this.needsReplay = true;
        }
    }

    // 再生位置変更終了
    public endChangeCurrentPosition(time: number): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        (<Video>this.$refs.video).setCurrentTime(time);

        // シーク前に再生中であれば再開
        if (this.needsReplay === true) {
            (<Video>this.$refs.video).play();
        }
        this.needsReplay = null;
    }

    // 音量変更
    public onVolumechange(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        this.volume = (<Video>this.$refs.video).getVolume();
    }

    // video control 表示切り替え
    public toggleControl(): void {
        this.isShowControl = !this.isShowControl;
    }

    // 再生状態切り替え
    public togglePlay(e: Event): void {
        e.stopPropagation();

        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        if ((<Video>this.$refs.video).paused() === true) {
            (<Video>this.$refs.video).play();
        } else {
            (<Video>this.$refs.video).pause();
        }
    }

    /**
     * 動画の長さを返す (秒)
     * @return number
     */
    private getVideoDuration(): number {
        return typeof this.$refs.video === 'undefined' ? 0 : (<Video>this.$refs.video).getDuration();
    }

    /**
     * 動画の現在再生位置を返す (秒)
     * @return number
     */
    private getVideoCurrentTime(): number {
        return typeof this.$refs.video === 'undefined' ? 0 : (<Video>this.$refs.video).getCurrentTime();
    }

    /**
     * mute 切り替え
     */
    public switchMute(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        (<Video>this.$refs.video).switchMute();
    }

    /**
     * 音量変更
     */
    public changeVolume(volume: number): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        (<Video>this.$refs.video).setVolume(volume);
    }

    // pip 切り替え
    public switchPip(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        try {
            if ((<any>document).pictureInPictureElement === null) {
                (<Video>this.$refs.video).requestPictureInPicture();
            } else {
                (<any>document).exitPictureInPicture();
            }
        } catch (error) {
            console.error(error);
        }
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
            } else if ((<any>document).mozCancelFullScreen) {
                (<any>document).mozCancelFullScreen();
            } else if ((<any>document).webkitCancelFullScreen) {
                (<any>document).webkitCancelFullScreen();
            } else if ((<any>document).msExitFullscreen) {
                (<any>document).msExitFullscreen();
            }
        } else {
            // フルスクリーンへ切り替え
            if (
                this.requestFullscreen(<HTMLElement>this.$refs.container) === false &&
                typeof this.$refs.video !== 'undefined'
            ) {
                this.requestFullscreen(<HTMLElement>this.$refs.video);
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
        } else if ((<any>e).mozRequestFullScreen) {
            (<any>e).mozRequestFullScreen();
            return true;
        } else if ((<any>e).webkitRequestFullScreen) {
            (<any>e).webkitRequestFullScreen();
            return true;
        } else if ((<any>e).webkitEnterFullscreen) {
            (<any>e).webkitEnterFullscreen();
            return true;
        } else if ((<any>e).msRequestFullscreen) {
            (<any>e).msRequestFullscreen();
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
                await (<any>window.screen).orientation.lock('natural');
            } else {
                await (<any>window.screen).orientation.lock('landscape');
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
        return !this.isEnabledRotation || (<any>window.screen).orientation.angle !== 0;
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

    &::before
        content: ""
        display: block
        padding-top: 56.25%

    .video-content
        position: absolute
        top: 0
        left: 0
        width: 100%
        height: 100%

    .loading
        z-index: 3
        position: absolute
        height: 100%
        width: 100%
        display: flex
        flex-direction: column
        justify-content: center
        align-items: center

    .video-control-wrap
        z-index: 2
        position: relative
        height: 100%
        width: 100%

        .center-buttons
            position: absolute
            top: 50%
            left: 50%
            transform: translateY(-50%) translateX(-50%)
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

            @media screen and (max-width: 400px)
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
</style>

<style lang="sass">
.video-container
    .play-button, .rewind, .forward
        .v-icon
            text-shadow: 0px 0px 10px black
    .play-button
        .v-icon
            font-size: 60px
    .slider
        .v-slider
            min-height: 10px
        .v-input__slot
            margin: 0
        .v-messages
            display: none

.video-menu
    .v-text-field__details
        display: none
</style>
