<template>
    <video ref="video" playsinline></video>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IRecordedHLSStreamingVideoState from '@/model/state/recorded/streaming/IRecordedHLSStreamingVideoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import UaUtil from '@/util/UaUtil';
import Util from '@/util/Util';
import Hls from 'hls.js';
import { Component, Prop, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

interface VideoSrcInfo {
    videoFileId: apid.VideoFileId;
    mode: number;
    playPosition: number;
}

@Component({})
export default class RecordedHLSStreamingVideo extends BaseVideo {
    @Prop({ required: true })
    public recordedId!: apid.RecordedId;

    @Prop({ required: true })
    public mode!: number;

    @Prop({ required: true })
    public videoFileId!: apid.VideoFileId;

    protected videoState = container.get<IRecordedHLSStreamingVideoState>('IRecordedHLSStreamingVideoState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async (): Promise<void> => {
        await this.updateVideoInfo();
    }).bind(this);
    private hls: Hls | null = null;
    private basePlayPosition: number = 0;
    private dummyPlayPosition: number | null = null; // setCurrentTime が呼ばれている間に再生位置として返すダミー値
    private pauseStateBeforeCurrentTime: boolean = false; // setCurrentTime が処理終了時に再生状態を復元するための値
    private lastUpdatePauseState: number = 0; // 最後に pauseStateBeforeCurrentTime を更新した時間
    private updateDurationTimerId: number | undefined; // 録画中の番組の動画長を更新するためのタイマー
    private setCurrentTimeTimerId: number | undefined; // setCurrentTime を大量に呼び出さないようにするためのタイマー
    private lastSeekTime: number = 0; // setCurrentTime 実行中に setCurrentTime が重ねて実行されたか確認するための変数

    public created(): void {
        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public mounted(): void {
        this.$nextTick(async () => {
            await this.videoState.clear();
            await this.updateVideoInfo();

            // 録画中の場合は duration が変化するので定期的に timeupdate を発行する
            if (this.videoState.isRecording() === true) {
                this.updateDurationTimerId = setInterval(() => {
                    this.onTimeupdate();

                    // 録画中でなくなったらタイマーを止める
                    if (this.videoState.isRecording() === false) {
                        clearInterval(this.updateDurationTimerId);
                    }
                }, 1000);
            }

            // HLS stream 開始
            await this.videoState.start(this.videoFileId, this.basePlayPosition, this.mode).catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: 'ストリーム開始に失敗',
                });
            });

            // ストリームが有効になるまで待つ
            await this.waitForEnabled();
            super.mounted();
        });
    }

    /**
     * ストリームが有効化になるまで待つ
     * @return Promise<void>
     */
    private waitForEnabled(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.videoState.getStreamId() === null) {
                return;
            }

            // ストリームが有効になるまで待つ
            const checkEnabledTimerId = setInterval(async () => {
                if ((await this.videoState.isEnabled()) === false) {
                    return;
                }

                clearInterval(checkEnabledTimerId);
                resolve();
            }, 1000);
        });
    }

    /**
     * socket.io での状態更新通知時処理
     * @return Promise<void>
     */
    private async updateVideoInfo(): Promise<void> {
        await this.videoState.fetchInfo(this.recordedId, this.videoFileId);
        if (this.videoState.isRecording() === false) {
            clearInterval(this.updateDurationTimerId);
        }
    }

    public async beforeDestroy(): Promise<void> {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);

        super.beforeDestroy();

        this.destoryHls();

        await this.videoState.stop().catch(err => {
            this.snackbarState.open({
                color: 'error',
                text: 'ストリーム停止に失敗',
            });
        });
    }

    /**
     * destory hls
     */
    private destoryHls(): void {
        if (this.hls === null) {
            return;
        }
        this.hls.stopLoad();
        this.hls.detachMedia();
        this.hls.destroy();
        this.hls = null;
    }

    /**
     * video 再生初期設定
     */
    protected initVideoSetting(): void {
        if (this.video === null) {
            return;
        }

        const streamId = this.videoState.getStreamId();
        if (streamId === null) {
            this.snackbarState.open({
                color: 'error',
                text: 'ストリーム id 取得に失敗',
            });
            throw new Error('StreamIdIsNull');
        }

        const videoSrc = `/streamfiles/stream${streamId}.m3u8`;
        if (this.isSupportedHLSjs() === true) {
            // hls.js 非対応
            this.setSrc(videoSrc);
            this.load();
            this.play()
                .then(async () => {
                    if (this.video === null) {
                        return;
                    }
                    this.video.currentTime = 0;
                })
                .catch(async err => {
                    if (this.video === null) {
                        return;
                    }
                    this.video.currentTime = 0;
                });
        } else {
            // hls.js 対応
            this.hls = new Hls();
            this.hls.loadSource(videoSrc);
            this.hls.attachMedia(this.video);
            this.hls.once(Hls.Events.MANIFEST_PARSED, async () => {
                if (this.video !== null) {
                    setTimeout(async () => {
                        if (this.video === null) {
                            return;
                        }
                        this.video.currentTime = 0;
                        await this.video.play().catch(err => {});
                        this.video.currentTime = 0;
                    }, 100);
                }
            });
        }
    }

    private isSupportedHLSjs(): boolean {
        return Hls.isSupported() === false || (UaUtil.isiOS() === true && UaUtil.isiPadOS() === false);
    }

    /**
     * 動画の長さを返す (秒)
     * @return number
     */
    public getDuration(): number {
        return this.videoState.getDuration();
    }

    /**
     * 動画の現在再生位置を返す (秒)
     * @return number
     */
    public getCurrentTime(): number {
        if (this.dummyPlayPosition !== null) {
            return this.dummyPlayPosition;
        }

        return this.video === null ? 0 : this.basePlayPosition + super.getCurrentTime();
    }

    /**
     * 再生位置設定
     * @param time: number (秒)
     */
    public setCurrentTime(time: number): void {
        if (this.video === null) {
            return;
        }

        // エンコード済み範囲か
        if (time >= this.basePlayPosition && time <= this.basePlayPosition + super.getDuration()) {
            super.setCurrentTime(time - this.basePlayPosition);
            this.onTimeupdate();

            return;
        }

        const now = new Date().getTime();
        if (this.dummyPlayPosition === null && now - this.lastUpdatePauseState > 1000) {
            this.pauseStateBeforeCurrentTime = this.paused();
            this.lastUpdatePauseState = now;
        }
        this.dummyPlayPosition = time;
        this.onTimeupdate();

        clearTimeout(this.setCurrentTimeTimerId);
        this.setCurrentTimeTimerId = setTimeout(async () => {
            if (this.video === null) {
                return;
            }

            const playbackRate = this.video.playbackRate;

            this.unload();
            this.destoryHls();
            this.basePlayPosition = time;
            this.onWaiting();
            this.onPause();

            const beforeStartStream = new Date().getTime();
            this.lastSeekTime = beforeStartStream;

            try {
                if (this.lastSeekTime !== beforeStartStream) {
                    return;
                }
                await this.videoState.stop();
                if (this.lastSeekTime !== beforeStartStream) {
                    return;
                }
                await this.videoState.start(this.videoFileId, this.basePlayPosition, this.mode);
                if (this.lastSeekTime !== beforeStartStream) {
                    return;
                }
                await this.waitForEnabled();
                if (this.lastSeekTime !== beforeStartStream) {
                    return;
                }
                this.initVideoSetting();
            } catch (err) {
                console.error(err);
                await this.videoState.stop();
                this.setCurrentTime(time);

                return;
            }

            if (this.isSupportedHLSjs() === false) {
                this.video.currentTime = 0;
            }
            await Util.sleep(500);
            this.video.playbackRate = playbackRate;
            this.dummyPlayPosition = null;
        }, 200);
    }
}
</script>
