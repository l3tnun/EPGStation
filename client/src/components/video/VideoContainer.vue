<template>
    <div class="video-container">
        <div class="video-content">
            <div v-if="isLoading === true || videoSrc === null" class="loading">
                <v-progress-circular :size="50" color="primary" indeterminate></v-progress-circular>
            </div>
            <div class="video-control" v-on:click="toggleControl">
                <transition name="fade">
                    <v-btn v-if="isShowControl === true" class="play-button mx-2" fab large v-on:click="togglePlay">
                        <v-icon v-if="isPause === true" dark>mdi-play</v-icon>
                        <v-icon v-else dark>mdi-pause</v-icon>
                    </v-btn>
                </transition>
            </div>
            <Video
                v-if="videoSrc !== null"
                ref="video"
                v-bind:videoSrc.sync="videoSrc"
                v-on:waiting="onWaiting"
                v-on:loadeddata="onLoadeddata"
                v-on:canplay="onCanplay"
                v-on:ended="onEnded"
                v-on:play="onPlay"
                v-on:pause="onPause"
            ></Video>
        </div>
    </div>
</template>

<script lang="ts">
import Video from '@/components/video/Video.vue';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import Util from '../../util/Util';

@Component({
    components: {
        Video,
    },
})
export default class VideoContainer extends Vue {
    @Prop({ required: true })
    public videoSrc!: string | null;

    public isLoading: boolean = true;
    public isPause: boolean = true;

    public isShowControl: boolean = false;

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
        if (this.isPause === true) {
            this.isShowControl = true;
        }
    }

    // 終了
    public onEnded(): void {
        this.isLoading = false;
    }

    // 再生
    public async onPlay(): Promise<void> {
        this.isPause = false;
        await Util.sleep(200);
        this.isShowControl = false;
    }

    // 停止
    public onPause(): void {
        this.isPause = true;
    }

    // video control 表示切り替え
    public toggleControl(): void {
        console.log('on toggle control');
        this.isShowControl = !this.isShowControl;
    }

    // 再生状態切り替え
    public togglePlay(e: Event): void {
        e.stopPropagation();

        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        if (this.isPause === true) {
            (<Video>this.$refs.video).play();
        } else {
            (<Video>this.$refs.video).pause();
        }
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

    .video-control
        z-index: 2
        position: relative
        height: 100%
        width: 100%
        .play-button
            position: absolute
            top: 50%
            left: 50%
            transform: translateY(-50%) translateX(-50%)

    video
        z-index: 1
        position: absolute
        top: 0
        right: 0
        bottom: 0
        left: 0
        margin: auto
        width: 100%
</style>
