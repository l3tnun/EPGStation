<template>
    <v-dialog v-if="isRemove === false" v-model="dialogModel" max-width="500" scrollable>
        <v-card>
            <div class="pa-4">
                <div class="subtitle-1">{{ recordedItem.name }}</div>
                <div class="body-1 mt-2">video files</div>
                <div class="d-flex">
                    <v-btn v-for="v in videoFiles" v-on:click="downloadVideo(v.video)" v-bind:key="v.video.id" color="primary" class="ma-1">
                        {{ v.name }}
                    </v-btn>
                </div>
                <div class="body-1 mt-2">play lists</div>
                <v-btn v-for="video in recordedItem.videoFiles" v-bind:key="video.id" v-on:click="downloadPlayList(video)" color="primary" class="ma-1">
                    {{ video.name }}
                </v-btn>
            </div>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IRecordedUtil from '@/model/state/recorded/IRecordedUtil';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

interface DwonloadVideoFileInfo {
    video: apid.VideoFile;
    name: string; // ビデオ名 + サイズ
}

@Component({})
export default class RecordedDownloadDialog extends Vue {
    @Prop({ required: true })
    public recordedItem!: apid.RecordedItem;

    @Prop({ required: true })
    public isOpen!: boolean;

    public isRemove: boolean = false;

    private recordedUtil: IRecordedUtil = container.get<IRecordedUtil>('IRecordedUtil');

    get videoFiles(): DwonloadVideoFileInfo[] {
        return typeof this.recordedItem.videoFiles === 'undefined'
            ? []
            : this.recordedItem.videoFiles.map(v => {
                  return {
                      video: v,
                      name: `${v.name} (${Util.getFileSizeStr(v.size)})`,
                  };
              });
    }

    /**
     * Prop で受け取った isOpen を直接は書き換えられないので
     * getter, setter を用意する
     */
    get dialogModel(): boolean {
        return this.isOpen;
    }
    set dialogModel(value: boolean) {
        this.$emit('update:isOpen', value);
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === false && oldState === true) {
            // close
            this.$nextTick(async () => {
                await Util.sleep(100);
                // dialog close アニメーションが終わったら要素を削除する
                this.isRemove = true;
                this.$nextTick(() => {
                    this.isRemove = false;
                });
            });
        }
    }

    public downloadVideo(video: apid.VideoFile): void {
        this.$emit('download', video);
    }

    public downloadPlayList(video: apid.VideoFile): void {
        this.$emit('downloadPlayList', video);
    }
}
</script>
