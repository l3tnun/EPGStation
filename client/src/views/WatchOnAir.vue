<template>
    <v-content>
        <TitleBar title="視聴"></TitleBar>
        <transition name="page">
            <VideoContainer v-if="videoParam !== null" v-bind:videoParam="videoParam"></VideoContainer>
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

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

interface WatchParam {
    type: string;
    channel: string;
    mode: string;
}

@Component({
    components: {
        TitleBar,
        VideoContainer,
        Snackbar,
    },
})
export default class WatchOnAir extends Vue {
    public videoParam: VideoParam.BaseVideoParam | null = null;

    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    private watchParam: WatchParam | null = null;

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        // 視聴パラメータセット
        this.watchParam =
            typeof this.$route.query.type !== 'string' ||
            typeof this.$route.query.channel !== 'string' ||
            typeof this.$route.query.mode !== 'string'
                ? null
                : {
                      type: this.$route.query.type,
                      channel: this.$route.query.channel,
                      mode: this.$route.query.mode,
                  };

        this.$nextTick(async () => {
            if (this.watchParam !== null) {
                if (this.watchParam.type === 'hls') {
                    (<VideoParam.LiveHLSParam>this.videoParam) = {
                        type: 'LiveHLS',
                        channelId: parseInt(this.watchParam.channel, 10),
                        mode: parseInt(this.watchParam.mode, 10),
                    };
                } else {
                    (<VideoParam.NormalVideoParam>this.videoParam) = {
                        type: 'Normal',
                        src: `/api/streams/live/${this.watchParam.channel}/${this.watchParam.type}?mode=${this.watchParam.mode}`,
                    };
                }
            }

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }
}
</script>
