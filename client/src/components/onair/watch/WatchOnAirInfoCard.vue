<template>
    <div v-if="displayInfo !== null" class="watch-on-air-info-card pa-2">
        <v-card class="mx-auto" max-width="800">
            <v-list-item three-line style="cursor: pointer">
                <v-list-item-content>
                    <div class="subtitle-1 font-weight-black">{{ displayInfo.channelName }}</div>
                    <div class="caption font-weight-light">{{ displayInfo.time }}</div>
                    <div class="subtitle-2">
                        {{ displayInfo.name }}
                    </div>
                    <div class="body-2 font-weight-light">{{ displayInfo.description }}</div>
                </v-list-item-content>
            </v-list-item>
        </v-card>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IWatchOnAirInfoState, { DsiplayWatchInfo } from '@/model/state/onair/watch/IWatchOnAirInfoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../../api';

@Component({})
export default class WatchOnAirInfoCard extends Vue {
    @Prop({ required: true })
    public channel!: apid.ChannelId;

    @Prop({ required: true })
    public mode!: number;

    public displayInfo: DsiplayWatchInfo | null = null;

    private infoState: IWatchOnAirInfoState = container.get<IWatchOnAirInfoState>('IWatchOnAirInfoState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async (): Promise<void> => {
        await this.update();
    }).bind(this);
    private updateTimer: number | null = null;

    public created(): void {
        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);

        if (this.updateTimer !== null) {
            clearTimeout(this.updateTimer);
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.infoState.clear();
        this.displayInfo = null;
        this.$nextTick(async () => {
            await this.update();
        });
    }

    private async update(): Promise<void> {
        await this.infoState.update(this.channel, this.mode).catch(err => {
            this.snackbarState.open({
                color: 'error',
                text: 'ストリーム情報取得に失敗',
            });
            console.error(err);
        });

        this.displayInfo = this.infoState.getInfo();

        if (this.updateTimer !== null) {
            clearTimeout(this.updateTimer);
        }
        this.updateTimer = setTimeout(() => {
            this.update();
        }, this.infoState.getUpdateTime());
    }
}
</script>
