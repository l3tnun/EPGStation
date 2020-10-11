<template>
    <v-content>
        <TitleBar title="ストレージ"></TitleBar>
        <transition name="page">
            <div v-if="storageState.getInfos().length > 0" ref="appContent" class="app-content">
                <v-container>
                    <div v-for="info in storageState.getInfos()" v-bind:key="info.name" class="pa-2">
                        <h3 class="text--primary">{{ info.name }} - {{ info.total }}</h3>
                        <v-progress-linear :value="info.useRate" height="25"></v-progress-linear>
                        <div class="d-flex body-2 text--secondary pt-1">
                            <div>{{ info.used }} 使用済み</div>
                            <v-spacer></v-spacer>
                            <div>{{ info.available }} 空き</div>
                        </div>
                    </div>
                </v-container>
            </div>
        </transition>
    </v-content>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import IStorageState from '@/model/state/storage/IStorageState';
import { Component, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
    },
})
export default class Storages extends Vue {
    public knowledge = 33;

    private storageState = container.get<IStorageState>('IStorageState');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async (): Promise<void> => {
        await this.storageState.fetchData();
    }).bind(this);

    public created(): void {
        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.storageState.clearData();
        this.$nextTick(async () => {
            await this.storageState.fetchData().catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: 'ストレージ情報取得に失敗',
                });
                console.error(err);
            });

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }
}
</script>
