<template>
    <video ref="video" autoplay playsinline></video>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Prop, Watch } from 'vue-property-decorator';
import Mpegts from 'mpegts.js';

@Component({})
export default class LiveMpegTsVideo extends BaseVideo {
    @Prop({ required: true })
    public videoSrc!: string;

    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private mepgtsPlayer: Mpegts.Player | null = null;

    public mounted(): void {
        super.mounted();
    }

    public async beforeDestroy(): Promise<void> {
        if (this.mepgtsPlayer !== null) {
            this.mepgtsPlayer.pause();
            this.mepgtsPlayer.unload();
            this.mepgtsPlayer.destroy();
            this.mepgtsPlayer = null;
        }

        super.beforeDestroy();
    }

    /**
     * video 再生初期設定
     */
    protected initVideoSetting(): void {
        // 対応しているか確認
        if (Mpegts.isSupported() === false) {
            this.snackbarState.open({
                color: 'error',
                text: '非対応ブラウザーです。',
            });

            throw new Error('UnsupportedBrowser');
        }

        if (this.video === null) {
            this.snackbarState.open({
                color: 'error',
                text: 'video 要素がありません。',
            });
            throw new Error('VideoIsNull');
        }

        this.mepgtsPlayer = Mpegts.createPlayer({
            type: 'mse',
            isLive: true,
            url: this.videoSrc,
        });
        this.mepgtsPlayer.attachMediaElement(this.video);
        this.mepgtsPlayer.load();
        this.mepgtsPlayer.play();
    }
}
</script>
