<template>
    <v-content>
        <TitleBar title="アップロード"></TitleBar>
        <transition name="page">
            <v-card></v-card>
        </transition>
    </v-content>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import { IRecordedUploadState } from '@/model/state/recorded/upload/IRecordedUploadState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
    },
})
export default class RecordedUpload extends Vue {
    private uploadState: IRecordedUploadState = container.get<IRecordedUploadState>('IRecordedUploadState');
    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public created(): void {}

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.uploadState.init();
        this.$nextTick(async () => {
            await this.uploadState.fetchData().catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: 'ルール情報取得に失敗',
                });
                console.error(err);
            });

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }
}
</script>
