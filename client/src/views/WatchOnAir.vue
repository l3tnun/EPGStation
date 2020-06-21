<template>
    <v-content>
        <TitleBar title="視聴"></TitleBar>
        <transition name="page">
            <div>watch on air</div>
        </transition>
        <Snackbar></Snackbar>
    </v-content>
</template>

<script lang="ts">
import Snackbar from '@/components/snackbar/Snackbar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
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
        Snackbar,
    },
})
export default class WatchOnAir extends Vue {
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    private watchParam: WatchParam | null = null;

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        // TODO HLS への対応はまだ
        if (this.$route.query.type === 'hls') {
            this.snackbarState.open({
                color: 'error',
                text: 'HLS 視聴未対応',
            });
            this.watchParam = null;
            this.$nextTick(async () => {
                await this.scrollState.emitDoneGetData();
            });

            return;
        }

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
            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }
}
</script>
