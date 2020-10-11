<template>
    <v-content>
        <TitleBar title="録画詳細">
            <template v-slot:menu>
                <RecordedDetailMoreButton
                    v-if="recorded !== null"
                    :recordedItem="recorded.recordedItem"
                    v-on:download="downloadVideo"
                    v-on:downloadPlayList="downloadPlayList"
                ></RecordedDetailMoreButton>
            </template>
        </TitleBar>
        <v-container>
            <transition name="page">
                <div v-if="recorded !== null" ref="appContent" class="app-content mx-auto">
                    <div class="content-0 mx-auto">
                        <div class="thumbnail">
                            <v-img
                                aspect-ratio="1.7778"
                                width="100%"
                                max-height="400"
                                :src="recorded.display.topThumbnailPath"
                                v-on:error="this.src = './img/noimg.png'"
                                :eager="true"
                            ></v-img>
                        </div>
                        <div class="content-description">
                            <div class="title font-weight-bold">
                                {{ recorded.display.name }}
                            </div>
                            <div class="subtitle-1 my-1">
                                {{ recorded.display.channelName }}
                            </div>
                            <div class="subtitle-2 font-weight-light">
                                {{ recorded.display.genre }}
                            </div>
                            <div class="subtitle-2 font-weight-light">
                                {{ recorded.display.time }} ({{ recorded.display.duration }}
                                m)
                            </div>
                            <div class="body-2 mt-2 font-weight-light drop" v-bind:class="{ droped: recorded.display.hasDrop === true }" v-on:click="showDropLog">
                                {{ recorded.display.drop }}
                            </div>
                            <div class="button-wrap mt-2 d-flex flex-wrap">
                                <div class="d-flex flex-wrap">
                                    <RecordedDetailPlayButton
                                        v-if="typeof recorded.display.videoFiles !== 'undefined'"
                                        title="play"
                                        button="mdi-play"
                                        :videoFiles="recorded.display.videoFiles"
                                        v-on:play="play"
                                    ></RecordedDetailPlayButton>
                                    <RecordedDetailPlayButton
                                        v-if="typeof recorded.display.canStremingVideoFiles !== 'undefined'"
                                        title="streaming"
                                        button="mdi-play-circle"
                                        :videoFiles="recorded.display.canStremingVideoFiles"
                                        v-on:play="streaming"
                                    ></RecordedDetailPlayButton>
                                </div>
                                <div class="d-flex flex-wrap">
                                    <RecordedDetailEncodeButton :recordedItem="recorded.recordedItem" :videoFiles="recorded.display.videoFiles"></RecordedDetailEncodeButton>
                                    <RecordedDetailStopEncodeButton :recordedItem="recorded.recordedItem" v-on:stopEncode="stopEncode"></RecordedDetailStopEncodeButton>
                                </div>
                                <RecordedDetailKodiButton :recordedItem="recorded.recordedItem" :videoFiles="recorded.display.videoFiles"></RecordedDetailKodiButton>
                            </div>
                        </div>
                    </div>
                    <div class="content-1 mt-6">
                        <div class="body-2 description">
                            {{ recorded.display.description }}
                        </div>
                        <div v-if="isHideExtend === false" ref="extend" class="mt-2 body-2 extended">
                            {{ recorded.display.extended }}
                        </div>
                    </div>
                    <RecordedDetailSelectStreamDialog></RecordedDetailSelectStreamDialog>
                    <DropLogDialog :isOpen.sync="isOpenDropLogDialog"></DropLogDialog>
                </div>
            </transition>
        </v-container>
    </v-content>
</template>

<script lang="ts">
import DropLogDialog from '@/components/dropLog/DropLogDialog.vue';
import RecordedDetailEncodeButton from '@/components/recorded/detail/RecordedDetailEncodeButton.vue';
import RecordedDetailKodiButton from '@/components/recorded/detail/RecordedDetailKodiButton.vue';
import RecordedDetailMoreButton from '@/components/recorded/detail/RecordedDetailMoreButton.vue';
import RecordedDetailPlayButton from '@/components/recorded/detail/RecordedDetailPlayButton.vue';
import RecordedDetailSelectStreamDialog from '@/components/recorded/detail/RecordedDetailSelectStreamDialog.vue';
import RecordedDetailStopEncodeButton from '@/components/recorded/detail/RecordedDetailStopEncodeButton.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IDropLogDialogState from '@/model/state/dropLog/IDropLogDialogState';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import IRecordedDetailSelectStreamState from '@/model/state/recorded/detail/IRecordedDetailSelectStreamState';
import { RecordedDisplayData } from '@/model/state/recorded/IRecordedUtil';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';
import { Component, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../api';
import IRecordedDetailState from '../model/state/recorded/detail/IRecordedDetailState';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
        RecordedDetailPlayButton,
        RecordedDetailEncodeButton,
        RecordedDetailStopEncodeButton,
        RecordedDetailMoreButton,
        RecordedDetailSelectStreamDialog,
        RecordedDetailKodiButton,
        DropLogDialog,
    },
})
export default class RecordedDetail extends Vue {
    public isHideExtend = false;
    public isOpenDropLogDialog = false;

    public recordedDetailState: IRecordedDetailState = container.get<IRecordedDetailState>('IRecordedDetailState');
    private dropLogState: IDropLogDialogState = container.get<IDropLogDialogState>('IDropLogDialogState');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private settingValue: ISettingValue | null = null;
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async (): Promise<void> => {
        await this.fetchData();
    }).bind(this);
    public streamSelectDialogState: IRecordedDetailSelectStreamState = container.get<IRecordedDetailSelectStreamState>('IRecordedDetailSelectStreamState');

    get recorded(): RecordedDisplayData | null {
        return this.recordedDetailState.getRecorded();
    }

    public created(): void {
        this.settingValue = this.setting.getSavedValue();

        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
    }

    public async showDropLog(): Promise<void> {
        const recorded = this.recordedDetailState.getRecorded();
        if (recorded === null || typeof recorded.recordedItem.dropLogFile === 'undefined') {
            return;
        }

        this.dropLogState.setName(recorded.display.name);
        try {
            await this.dropLogState.fetchData(recorded.recordedItem.dropLogFile.id);
            this.isOpenDropLogDialog = true;
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: 'ログファイル取得に失敗しました',
            });
        }
    }

    public play(video: apid.VideoFile): void {
        if (video.type === 'encoded' && this.setting.getSavedValue().isPreferredPlayingOnWeb === true) {
            Util.move(this.$router, {
                path: '/recorded/watch',
                query: {
                    videoId: video.id.toString(10),
                    recordedId: this.$route.params.id,
                },
            });

            return;
        }

        const url = this.recordedDetailState.getVideoURL(video);

        location.href = url !== null ? url : this.recordedDetailState.getVideoPlayListURL(video);
    }

    public streaming(video: apid.VideoFile): void {
        this.streamSelectDialogState.open(video, parseInt(this.$route.params.id, 10));
    }

    public downloadVideo(video: apid.VideoFile): void {
        const url = this.recordedDetailState.getVideoDownloadURL(video);

        location.href = url !== null ? url : this.recordedDetailState.getVideoDownloadRawURL(video);
    }

    public downloadPlayList(video: apid.VideoFile): void {
        location.href = this.recordedDetailState.getVideoPlayListURL(video);
    }

    public async stopEncode(): Promise<void> {
        try {
            await this.recordedDetailState.stopEncode();
            this.snackbarState.open({
                color: 'success',
                text: 'エンコード停止',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: 'エンコード停止に失敗',
            });
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.recordedDetailState.clearData();
        this.$nextTick(async () => {
            await this.fetchData().catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '録画データ取得に失敗',
                });
                console.error(err);
            });

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    /**
     * データ取得
     */
    private async fetchData(): Promise<void> {
        await this.recordedDetailState.fetchData(parseInt(this.$route.params.id, 10), this.settingValue === null ? true : this.settingValue.isHalfWidthDisplayed);

        // 番組詳細 URL 処理
        this.$nextTick(() => {
            this.isHideExtend = true;
            this.$nextTick(() => {
                this.isHideExtend = false;
                this.$nextTick(() => {
                    if (typeof this.$refs.extend !== 'undefined') {
                        let str = (this.$refs.extend as Element).innerHTML;
                        str = str.replace(/(http:\/\/[\x21-\x7e]+)/gi, "<a href='$1' target='_blank'>$1</a>");
                        str = str.replace(/(https:\/\/[\x21-\x7e]+)/gi, "<a href='$1' target='_blank'>$1</a>");
                        (this.$refs.extend as Element).innerHTML = str;
                    }
                });
            });
        });
    }
}
</script>

<style lang="sass" scoped>
$switch-display-width: 800px

.app-content
    width: 100%

.thumbnail
    margin-top: auto
    margin-bottom: auto
    min-width: 100px
    max-height: 240px
    overflow: hidden


.content-description
    margin-top: 8px

.drop
    cursor: pointer
.droped
    display: inline-block
    color: red
    background-color: pink
    font-weight: bold !important

.description, .extended
    white-space: pre-wrap

@media screen and (min-width: $switch-display-width)
    .content-0
        display: flex

    .thumbnail
        min-width: 400px
        width: 400px
        max-height: auto

    .content-description
        margin-top: auto
        margin-bottom: auto
        margin-left: 6px
</style>
