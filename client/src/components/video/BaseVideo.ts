import UaUtil from '@/util/UaUtil';
import { Component, Vue } from 'vue-property-decorator';

export default abstract class BaseVide extends Vue {
    protected video: HTMLVideoElement | null = null;
    protected lastSubtitleState: TextTrackMode = 'disabled';

    public mounted(): void {
        this.video = this.$refs.video as HTMLVideoElement;

        // 時刻更新
        this.video.addEventListener('timeupdate', this.onTimeupdate.bind(this));

        // 読み込み中
        this.video.addEventListener('waiting', this.onWaiting.bind(this));

        // 読み込み完了
        this.video.addEventListener('loadeddata', this.onLoadeddata.bind(this));

        // 再生可能
        this.video.addEventListener('canplay', this.onCanplay.bind(this));

        // 終了
        this.video.addEventListener('ended', this.onEnded.bind(this));

        // 再生
        this.video.addEventListener('play', this.onPlay.bind(this));

        // 停止
        this.video.addEventListener('pause', this.onPause.bind(this));

        // 再生速度変化
        this.video.addEventListener('ratechange', this.onRatechange.bind(this));

        // 音量変化
        this.video.addEventListener('volumechange', this.onVolumechange.bind(this));

        this.initVideoSetting();
    }

    /**
     * video 再生初期設定
     */
    protected abstract initVideoSetting(): void;

    /**
     * video ソース設定
     */
    protected setSrc(src: string): void {
        if (this.video === null) {
            return;
        }

        this.video.src = src;
    }

    /**
     * video の 読み込み
     */
    protected load(): void {
        if (this.video === null) {
            return;
        }

        this.video.load();
    }

    /**
     * 読み込んだ video の破棄
     */
    protected unload(): void {
        if (this.video === null) {
            return;
        }

        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
    }

    /**
     * 時刻更新
     */
    protected onTimeupdate(): void {
        this.$emit('timeupdate');
    }

    /**
     * 読み込み中
     */
    protected onWaiting(): void {
        this.$emit('waiting');
    }

    /**
     * 読み込み完了
     */
    protected onLoadeddata(): void {
        this.$emit('loadeddata');
    }

    /**
     * 再生可能
     */
    protected onCanplay(): void {
        this.$emit('canplay');
    }

    /**
     * 終了
     */
    protected onEnded(): void {
        this.$emit('ended');
    }

    /**
     * 再生
     */
    protected onPlay(): void {
        this.$emit('play');
    }

    /**
     * 停止
     */
    protected onPause(): void {
        this.$emit('pause');
    }

    /**
     * 再生速度変化
     */
    protected onRatechange(): void {
        this.$emit('ratechange');
    }

    /**
     * 音量変化
     */
    protected onVolumechange(): void {
        this.$emit('volumechange');
    }

    public beforeDestroy(): void {
        this.unload();
    }

    /**
     * 動画再生
     */
    public async play(): Promise<void> {
        if (this.video === null) {
            return;
        }

        await this.video.play();
    }

    /**
     * 動画停止
     */
    public pause(): void {
        if (this.video === null) {
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
     * 再生速度を返す
     */
    public getPlaybackRate(): number {
        return this.video === null ? 1.0 : this.video.playbackRate;
    }

    /**
     * 再生速度を設定する
     */
    public setPlaybackRate(rate: number): void {
        if (this.video === null) {
            return;
        }

        this.video.playbackRate = rate;
    }

    /**
     * 動画の長さを返す (秒)
     * @return number
     */
    public getDuration(): number {
        return this.video === null || this.video.duration === Infinity || isNaN(this.video.duration) ? 0 : this.video.duration;
    }

    /**
     * 動画の現在再生位置を返す (秒)
     * @return number
     */
    public getCurrentTime(): number {
        return this.video === null || this.video.currentTime === Infinity || isNaN(this.video.currentTime) ? 0 : this.video.currentTime;
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
        if (this.video === null) {
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
     * video 要素にフルスクリーンリクエスト
     */
    public requestFullscreen(): boolean {
        if (this.video === null) {
            return false;
        }

        /* tslint:disable:newline-before-return */
        if (UaUtil.isAndroid()) {
            this.video.requestFullscreen({ navigationUI: 'hide' });
            return true;
        } else if (typeof this.video.requestFullscreen === 'function') {
            this.video.requestFullscreen();
            return true;
        } else if ((this.video as any).mozRequestFullScreen) {
            (this.video as any).mozRequestFullScreen();
            return true;
        } else if ((this.video as any).webkitRequestFullScreen) {
            (this.video as any).webkitRequestFullScreen();
            return true;
        } else if ((this.video as any).webkitEnterFullscreen) {
            (this.video as any).webkitEnterFullscreen();
            return true;
        } else if ((this.video as any).msRequestFullscreen) {
            (this.video as any).msRequestFullscreen();
            return true;
        }
        /* tslint:enable:newline-before-return */

        return false;
    }

    /**
     * pip 切り替え
     */
    public requestPictureInPicture(): void {
        if (this.video === null || typeof (this.video as any).requestPictureInPicture !== 'function') {
            return;
        }

        try {
            if (!(document as any).pictureInPictureElement) {
                (this.$refs.video as any).requestPictureInPicture();
            } else {
                (this.video as any).requestPictureInPicture();
            }
        } catch (err) {
            console.error(err);
        }
    }

    /**
     * 字幕が有効か
     * @return boolean true で有効
     */
    public isEnabledSubtitles(): boolean {
        return this.video !== null && this.video.textTracks.length > 0;
    }

    /**
     * 字幕が表示されているか
     * @return boolean true で表示されている
     */
    public isShowingSubtitle(): boolean {
        return this.video !== null && this.video.textTracks.length > 0 && this.video.textTracks[0].mode === 'showing';
    }

    /**
     * 字幕を表示させる
     */
    public showSubtitle(): void {
        if (this.video === null || this.video.textTracks.length === 0) {
            return;
        }

        this.video.textTracks[0].mode = 'showing';
        this.lastSubtitleState = this.video.textTracks[0].mode;
    }

    /**
     * 字幕を非表示にする
     */
    public disabledSubtitle(): void {
        if (this.video === null || this.video.textTracks.length === 0) {
            return;
        }

        this.video.textTracks[0].mode = 'disabled';
        this.lastSubtitleState = this.video.textTracks[0].mode;
    }

    /**
     * ユーザが最後に指定した字幕の表示状態と実際の状態がずれている場合に修正する
     */
    public fixSubtitleState(): void {
        if (this.video === null || this.video.textTracks.length === 0) {
            return;
        }

        if (this.video.textTracks[0].mode !== this.lastSubtitleState) {
            this.video.textTracks[0].mode = this.lastSubtitleState;
        }
    }
}
