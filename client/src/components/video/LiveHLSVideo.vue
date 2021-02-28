<template>
    <video ref="video" autoplay playsinline></video>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import container from '@/model/ModelContainer';
import ILiveHLSVideoState from '@/model/state/onair/ILiveHLSVideoState';
import IB24RenderState from '@/model/state/recorded/streaming/IB24RenderState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import UaUtil from '@/util/UaUtil';
import Hls from 'hls-b24.js';
import { Component, Prop, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class LiveHLSVideo extends BaseVideo {
    @Prop({ required: true })
    public channelId!: apid.ChannelId;

    @Prop({ required: true })
    public mode!: number;

    private videoState: ILiveHLSVideoState = container.get<ILiveHLSVideoState>('ILiveHLSVideoState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private checkEnabledTimerId: number | undefined;
    private hls: Hls | null = null;
    private b24RenderState: IB24RenderState = container.get<IB24RenderState>('IB24RenderState');

    public async mounted(): Promise<void> {
        // HLS stream 開始
        await this.videoState.start(this.channelId, this.mode).catch(err => {
            this.snackbarState.open({
                color: 'error',
                text: 'ストリーム開始に失敗',
            });
        });

        // ストリームが有効になるまで待つ
        this.checkEnabledTimerId = setInterval(async () => {
            if ((await this.videoState.isEnabled()) === false) {
                return;
            }

            clearInterval(this.checkEnabledTimerId);
            super.mounted();
        }, 1000);
    }

    public async beforeDestroy(): Promise<void> {
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

        const videoSrc = `./streamfiles/stream${streamId}.m3u8`;
        if (Hls.isSupported() === false || (UaUtil.isiOS() === true && UaUtil.isiPadOS() === false)) {
            // hls.js 非対応
            this.setSrc(videoSrc);
            this.load();
        } else {
            // hls.js 対応
            this.hls = new Hls();
            this.hls.loadSource(videoSrc);
            this.hls.attachMedia(this.video);
            this.hls.on(Hls.Events.MANIFEST_PARSED, async () => {
                if (this.video !== null) {
                    await this.video.play().catch(err => {});
                }
            });

            this.b24RenderState.init(this.video, this.hls);
        }
    }

    /**
     * destory hls
     */
    private destoryHls(): void {
        if (this.hls !== null) {
            this.hls.stopLoad();
            this.hls.detachMedia();
            this.hls.destroy();
            this.hls = null;
        }

        this.b24RenderState.destroy();
    }

    /**
     * 字幕が有効か
     * @return boolean true で有効
     */
    public isEnabledSubtitles(): boolean {
        return this.b24RenderState.isInited() !== true ? true : super.isEnabledSubtitles();
    }

    /**
     * 字幕を表示させる
     */
    public showSubtitle(): void {
        super.showSubtitle();
        this.b24RenderState.showSubtitle();
    }

    /**
     * 字幕を非表示にする
     */
    public disabledSubtitle(): void {
        super.disabledSubtitle();
        this.b24RenderState.disabledSubtitle();
    }
}
</script>
