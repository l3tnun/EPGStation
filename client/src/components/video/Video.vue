<template>
    <video ref="video" :src="videoSrc" autoplay playsinline></video>
</template>

<script lang="ts">
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';

@Component({})
export default class Video extends Vue {
    @Prop({ required: true })
    public videoSrc!: string;

    private video: HTMLVideoElement | null = null;

    public mounted(): void {
        this.video = <HTMLVideoElement>this.$refs.video;

        // 時刻更新
        this.video.addEventListener('timeupdate', () => {
            this.$emit('timeupdate');
        });

        // 読み込み中
        this.video.addEventListener('waiting', () => {
            this.$emit('waiting');
        });

        // 読み込み完了
        this.video.addEventListener('loadeddata', () => {
            this.$emit('loadeddata');
        });

        // 再生可能
        this.video.addEventListener('canplay', () => {
            this.$emit('canplay');
        });

        // 終了
        this.video.addEventListener('ended', () => {
            this.$emit('ended');
        });

        // 再生
        this.video.addEventListener('play', () => {
            this.$emit('play');
        });

        // 停止
        this.video.addEventListener('pause', () => {
            this.$emit('pause');
        });

        // 音量変化
        this.video.addEventListener('volumechange', () => {
            this.$emit('volumechange');
        });
    }

    public beforeDestroy(): void {
        if (this.video !== null) {
            this.video.pause();
            this.video.removeAttribute('src');
            this.video.load();
        }
    }

    /**
     * 動画再生
     */
    public play(): void {
        if (this.video === null || this.video.paused === false) {
            return;
        }

        this.video.play();
    }

    /**
     * 動画停止
     */
    public pause(): void {
        if (this.video === null || this.video.paused === true) {
            return;
        }

        this.video.pause();
    }

    /**
     * 停止中か
     */
    public paused(): boolean {
        return this.video === null ? true : this.video.paused;
    }

    /**
     * 動画の長さを返す (秒)
     * @return number
     */
    public getDuration(): number {
        return this.video === null || this.video.duration === Infinity || isNaN(this.video.duration)
            ? 0
            : this.video.duration;
    }

    /**
     * 動画の現在再生位置を返す (秒)
     * @return number
     */
    public getCurrentTime(): number {
        return this.video === null || this.video.currentTime === Infinity || isNaN(this.video.currentTime)
            ? 0
            : this.video.currentTime;
    }

    /**
     * 再生位置設定
     * @param time: number (秒)
     */
    public setCurrentTime(time: number): void {
        if (this.video === null) {
            return;
        }

        this.video.currentTime = time;
    }

    /**
     * 音量を返す
     * @return number
     */
    public getVolume(): number {
        return this.video === null || this.video.muted ? 0 : this.video.volume;
    }

    /**
     * mute 切り替え
     */
    public switchMute(): void {
        if (this.video === null || this.video.paused === true) {
            return;
        }

        this.video.muted = !this.video.muted;
    }

    /**
     * 音量設定
     * @param volume: number 0.0 ~ 1.0
     */
    public setVolume(volume: number): void {
        if (this.video === null) {
            return;
        }

        this.video.volume = volume;
    }

    /**
     * pip 切り替え
     */
    public requestPictureInPicture(): void {
        if (this.video === null || typeof (<any>this.video).requestPictureInPicture !== 'function') {
            return;
        }

        try {
            if (!(<any>document).pictureInPictureElement) {
                (<any>this.$refs.video).requestPictureInPicture();
            } else {
                (<any>this.video).requestPictureInPicture();
            }
        } catch (err) {
            console.error(err);
        }
    }
}
</script>
