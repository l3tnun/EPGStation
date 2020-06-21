<template>
    <div class="video-container">
        <div class="video-content">
            <div v-if="isLoading === true || videoSrc === null" class="loading">
                <v-progress-circular :size="50" color="primary" indeterminate></v-progress-circular>
            </div>
            <transition name="page">
                <v-btn v-if="isShowFirstPlayButton === true" class="play-button mx-2" fab large v-on:click="startPlay">
                    <v-icon dark>mdi-play</v-icon>
                </v-btn>
            </transition>
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

    public isFirstPlay: boolean = true;
    public isShowFirstPlayButton: boolean = false;

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
        if (this.isPause === true && this.isFirstPlay === true) {
            this.isShowFirstPlayButton = true;
        }
    }

    // 終了
    public onEnded(): void {
        this.isLoading = false;
    }

    // 再生
    public onPlay(): void {
        this.isPause = false;
        this.isFirstPlay = false;
        this.isShowFirstPlayButton = false;
    }

    // 停止
    public onPause(): void {
        this.isPause = true;
    }

    // 再生開始
    public startPlay(): void {
        if (typeof this.$refs.video === 'undefined') {
            return;
        }

        (<Video>this.$refs.video).play();
        this.isFirstPlay = true;
        this.isShowFirstPlayButton = false;
    }
}
</script>

<style lang="sass" scoped>
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

    .play-button
        z-index: 2
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
