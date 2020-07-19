<template>
    <v-content>
        <TitleBar title="視聴"></TitleBar>
        <transition name="page">
            <div class="video-container-wrap mx-auto">
                <VideoContainer v-if="videoParam !== null" v-bind:videoParam="videoParam"></VideoContainer>
                <div style="visibility: hidden;">dummy</div>
            </div>
        </transition>
        <Snackbar></Snackbar>
    </v-content>
</template>

<script lang="ts">
import Snackbar from '@/components/snackbar/Snackbar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import * as VideoParam from '@/components/video/ViedoParam';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../api';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
        VideoContainer,
        Snackbar,
    },
})
export default class WatchRecorded extends Vue {
    public videoParam: VideoParam.BaseVideoParam | null = null;

    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        // 視聴パラメータセット
        const videoId = typeof this.$route.query.videoId !== 'string' ? null : parseInt(this.$route.query.videoId, 10);

        this.$nextTick(async () => {
            if (videoId !== null) {
                (<VideoParam.NormalVideoParam>this.videoParam) = {
                    type: 'Normal',
                    src: `/api/videos/${videoId}`,
                };
            }

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }
}
</script>

<style lang="sass" scoped>
.video-container-wrap
    max-width: 1200px
</style>
