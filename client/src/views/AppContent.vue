<template>
    <v-app class="app-content-root">
        <div v-if="isDisconnected === true" class="disconnected"></div>
        <Navigation></Navigation>
        <router-view></router-view>
        <Snackbar></Snackbar>
    </v-app>
</template>

<script lang="ts">
import Navigation from '@/components/navigation/Navigation.vue';
import Snackbar from '@/components/snackbar/Snackbar.vue';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import { Container } from 'inversify';
import { Component, Vue, Watch } from 'vue-property-decorator';
import ISocketIOModel from '../model/socketio/ISocketIOModel';

@Component({
    components: {
        Navigation,
        Snackbar,
    },
})
export default class AppContent extends Vue {
    public isDisconnected: boolean = false;

    private storageModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public async created(): Promise<void> {
        // theme 設定を反映
        this.$vuetify.theme.dark = this.storageModel.getSavedValue().isForceDarkTheme;

        // socket.io 設定
        try {
            this.socketIoModel.Iinitialize();
            this.setSocketIO();
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: '設定ダウンロードに失敗しました',
                timeout: 5000,
            });
        }
    }

    /**
     * Sokcet,IO 設定
     */
    private setSocketIO(): void {
        const io = this.socketIoModel.getIO();

        if (io === null) {
            this.snackbarState.open({
                color: 'error',
                text: 'SocketIO の初期設定に失敗しました',
            });

            return;
        }

        // イベント設定
        io.on('disconnect', this.onDisconnect);
        io.on('reconnect', this.onReconnect);
    }

    /**
     * socketIO 切断時
     */
    private onDisconnect(): void {
        this.isDisconnected = true;

        this.$nextTick(() => {
            this.snackbarState.open({
                color: 'error',
                text: '接続が切断されました',
            });
        });
    }

    /**
     * socketIO 再接続時
     */
    private onReconnect(): void {
        this.isDisconnected = false;

        // reload
        const fullPath = this.$route.fullPath;
        this.$router.replace('/');
        this.$nextTick(() => {
            this.$router.replace(fullPath);

            this.$nextTick(() => {
                this.snackbarState.open({
                    text: '再接続されました',
                });
            });
        });
    }

    public destroyed(): void {
        const io = this.socketIoModel.getIO();
        if (io === null) {
            return;
        }

        // イベント削除
        io.off('disconnect', this.onDisconnect);
        io.off('reconnect', this.onReconnect);
    }

    /**
     * socket io path
     * @param port
     * @return string
     */
    private getSocketIoPath(port: number): string {
        return `${location.protocol}//${location.hostname}:${port}`;
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.snackbarState.close();
        this.scrollState.updateHistoryPosition();
    }
}
</script>

<style lang="sass" scoped>
.app-content-root
    .app-content
        margin: 0
        overflow-y: auto

    .disconnected
        position: fixed
        height: 100%
        width: 100%
        background: rgb(0, 0, 0, 0.6)
        background-attachment: fixed
        z-index: 1000
</style>
