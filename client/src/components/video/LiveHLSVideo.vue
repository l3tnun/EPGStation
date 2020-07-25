<template>
    <video ref="video" autoplay playsinline></video>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import container from '@/model/ModelContainer';
import ILiveHLSVideoState from '@/model/state/onair/ILiveHLSVideoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import UaUtil from '@/util/UaUtil';
import Hls from 'hls.js';
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

        const videoSrc = `/streamfiles/stream${streamId}.m3u8`;
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
        }
    }

    /**
     * destory hls
     */
    private destoryHls(): void {
        if (this.hls === null) {
            return;
        }
        this.hls.destroy();
        this.hls = null;
    }
}
</script>
