<template>
    <video ref="video" autoplay playsinline></video>
</template>

<script lang="ts">
import BaseVideo from '@/components/video/BaseVideo';
import UaUtil from '@/util/UaUtil';
import { Component, Prop, Watch } from 'vue-property-decorator';

@Component({})
export default class NormalVideo extends BaseVideo {
    @Prop({ required: true })
    public videoSrc!: string;

    public mounted(): void {
        super.mounted();
    }

    public async beforeDestroy(): Promise<void> {
        super.beforeDestroy();
    }

    /**
     * video 再生初期設定
     */
    protected initVideoSetting(): void {
        this.setSrc(this.videoSrc);
        this.load();
    }
}
</script>
