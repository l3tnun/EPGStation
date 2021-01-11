<template>
    <v-content>
        <TitleBar title="視聴"></TitleBar>
        <transition name="page">
            <div class="video-container-wrap mx-auto">
                <VideoContainer v-if="videoParam !== null" v-bind:videoParam="videoParam"></VideoContainer>
                <WatchOnAirInfoCard v-if="watchParam !== null" v-bind:channel="watchParam.channel" v-bind:mode="watchParam.mode"></WatchOnAirInfoCard>
                <div style="visibility: hidden">dummy</div>
            </div>
        </transition>
    </v-content>
</template>

<script lang="ts">
import WatchOnAirInfoCard from '@/components/onair/watch/WatchOnAirInfoCard.vue';
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

interface WatchParam {
    type: string;
    channel: apid.ChannelId;
    mode: number;
}

@Component({
    components: {
        TitleBar,
        VideoContainer,
        WatchOnAirInfoCard,
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
            typeof this.$route.query.type !== 'string' || typeof this.$route.query.channel !== 'string' || typeof this.$route.query.mode !== 'string'
                ? null
                : {
                      type: this.$route.query.type,
                      channel: parseInt(this.$route.query.channel, 10),
                      mode: parseInt(this.$route.query.mode, 10),
                  };

        this.$nextTick(async () => {
            if (this.watchParam !== null) {
                if (this.watchParam.type === 'hls') {
                    (this.videoParam as VideoParam.LiveHLSParam) = {
                        type: 'LiveHLS',
                        channelId: this.watchParam.channel,
                        mode: this.watchParam.mode,
                    };
                } else {
                    (this.videoParam as VideoParam.NormalVideoParam) = {
                        type: 'Normal',
                        src: `./api/streams/live/${this.watchParam.channel}/${this.watchParam.type}?mode=${this.watchParam.mode}`,
                    };
                }
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
