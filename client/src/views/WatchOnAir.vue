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

@Component({
    components: {
        TitleBar,
        Snackbar,
    },
})
export default class WatchOnAir extends Vue {
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.$nextTick(async () => {
            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }
}
</script>
