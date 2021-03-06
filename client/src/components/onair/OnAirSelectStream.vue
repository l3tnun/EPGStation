<template>
    <div class="on-ari-select-stream">
        <v-dialog v-if="isRemove === false" v-model="dialogState.isOpen" max-width="400" scrollable>
            <v-card v-if="dialogState.getChannelItem() !== null">
                <div class="pa-4 pb-0">
                    <div>{{ dialogState.getChannelItem().name }}</div>
                    <div class="d-flex">
                        <v-select
                            v-if="isHiddenStreamTypes === false"
                            :items="dialogState.streamTypes"
                            v-model="dialogState.selectedStreamType"
                            v-on:change="updateStreamConfig"
                            class="guide-time"
                            style="max-width: 120px"
                            :menu-props="{ auto: true }"
                        ></v-select>
                        <v-select
                            v-if="isHiddenStreamConfig === false"
                            :items="dialogState.streamConfigItems"
                            v-model="dialogState.selectedStreamConfig"
                            class="guide-time"
                            :menu-props="{ auto: true }"
                        ></v-select>
                    </div>
                    <div class="d-flex">
                        <v-switch value v-model="dialogState.useURLScheme" v-on:change="updateAllStreamConfig"></v-switch>
                        <v-list-item-title class="subtitle-1">外部アプリで開く</v-list-item-title>
                    </div>
                </div>
                <v-card-actions>
                    <v-btn v-if="!!needsGotoGuideButton === true" color="primary" text v-on:click="gotoGuide">番組表</v-btn>
                    <v-spacer></v-spacer>
                    <v-btn color="primary" text v-on:click="dialogState.isOpen = false">キャンセル</v-btn>
                    <v-btn color="primary" text v-on:click="view">視聴</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import Mpegts from 'mpegts.js';
import IOnAirSelectStreamState from '../../model/state/onair/IOnAirSelectStreamState';
import Util from '../../util/Util';

@Component({})
export default class OnAirSelectStream extends Vue {
    @Prop({ required: false })
    public needsGotoGuideButton: boolean | undefined;

    public dialogState: IOnAirSelectStreamState = container.get<IOnAirSelectStreamState>('IOnAirSelectStreamState');
    public isRemove: boolean = false;
    // ストリーム設定セレクタ再描画用
    public isHiddenStreamTypes: boolean = false;
    public isHiddenStreamConfig: boolean = false;

    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public beforeDestroy(): void {
        this.dialogState.close();
    }

    public updateAllStreamConfig(): void {
        this.dialogState.updateStreamTypes();
        this.dialogState.updateStreamConfig();

        // ストリーム設定セレクタ再描画
        this.isHiddenStreamTypes = true;
        this.isHiddenStreamConfig = true;
        this.$nextTick(() => {
            this.isHiddenStreamTypes = false;
            this.isHiddenStreamConfig = false;
        });
    }

    public updateStreamConfig(): void {
        this.dialogState.updateStreamConfig();

        // ストリーム設定セレクタ再描画
        this.isHiddenStreamConfig = true;
        this.$nextTick(() => {
            this.isHiddenStreamConfig = false;
        });
    }

    /**
     * 単局表示
     */
    public async gotoGuide(): Promise<void> {
        const channel = this.dialogState.getChannelItem();
        if (channel === null) {
            return;
        }

        const query: any = {
            channelId: channel.id,
        };
        if (typeof this.$route.query.time !== 'undefined') {
            query.time = this.$route.query.time;
        }

        this.dialogState.isOpen = false;
        await Util.sleep(300);
        await Util.move(this.$router, {
            path: '/guide',
            query: query,
        });
    }

    /**
     * 視聴する
     */
    public async view(): Promise<void> {
        if (this.dialogState.selectedStreamType === 'M2TS') {
            // URL Scheme による再生
            this.m2tsViewOnURLScheme();
        } else if (this.dialogState.selectedStreamType === 'M2TS-LL') {
            // 再生に対応しているか?
            if (Mpegts.isSupported() === false || Mpegts.getFeatureList().mseLivePlayback === false) {
                this.snackbarState.open({
                    color: 'error',
                    text: '再生に対応していません',
                });

                return;
            }

            await this.m2tsLLView().catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '視聴ページへの移動に失敗',
                });
            });
        } else {
            const channel = this.dialogState.getChannelItem();
            if (channel !== null && typeof this.dialogState.selectedStreamType !== 'undefined' && typeof this.dialogState.selectedStreamConfig !== 'undefined') {
                this.dialogState.isOpen = false;
                await Util.sleep(200);
                await Util.move(this.$router, {
                    path: '/onair/watch',
                    query: {
                        type: this.dialogState.selectedStreamType.toLowerCase(),
                        channel: channel.id.toString(10),
                        mode: this.dialogState.selectedStreamConfig.toString(10),
                    },
                }).catch(err => {
                    this.snackbarState.open({
                        color: 'error',
                        text: '視聴ページへの移動に失敗',
                    });
                });
            }
        }
    }

    /**
     * URL Scheme による m2ts 形式の再生
     */
    private m2tsViewOnURLScheme(): void {
        const url = this.dialogState.getM2TSURL();

        if (url === null) {
            const playList = this.dialogState.getM2TPlayListURL();
            if (playList === null) {
                this.snackbarState.open({
                    color: 'error',
                    text: '視聴 URL 生成に失敗',
                });
            } else {
                location.href = playList;
            }
        } else {
            location.href = url;
        }
    }

    /**
     * M2TS Low  Latency 形式の再生
     */
    private async m2tsLLView(): Promise<void> {
        const channel = this.dialogState.getChannelItem();
        if (channel !== null && typeof this.dialogState.selectedStreamType !== 'undefined' && typeof this.dialogState.selectedStreamConfig !== 'undefined') {
            this.dialogState.isOpen = false;
            await Util.sleep(200);
            await Util.move(this.$router, {
                path: '/onair/watch',
                query: {
                    type: 'm2tsll',
                    channel: channel.id.toString(10),
                    mode: this.dialogState.selectedStreamConfig.toString(10),
                },
            }).catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '視聴ページへの移動に失敗',
                });
            });
        }
    }

    /**
     * dialog の表示状態が変更されたときに呼ばれる
     */
    @Watch('dialogState.isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === false && oldState === true) {
            // close
            this.$nextTick(async () => {
                await Util.sleep(100);
                this.isRemove = true;
                this.$nextTick(() => {
                    this.isRemove = false;
                    this.dialogState.close();
                });
            });
        }
    }
}
</script>
