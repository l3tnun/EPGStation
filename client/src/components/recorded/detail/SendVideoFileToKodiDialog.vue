<template>
    <v-dialog v-if="isRemove === false" v-model="dialogModel" max-width="400" scrollable>
        <v-card>
            <div class="pa-3 pt-4 pb-0 add-encode">
                <div class="subtitle-1">{{ recordedItem.name }}</div>
                <v-select :items="dialogState.getHosts()" v-model="dialogState.hostName" label="kodi host" :menu-props="{ auto: true }" class="preset"></v-select>

                <div class="d-flex flex-wrap">
                    <v-btn v-for="video in videoFiles" v-bind:key="video.id" color="success" dark class="ma-1" v-on:click="send(video.id)">
                        {{ video.name }}
                    </v-btn>
                </div>
            </div>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn v-on:click="close" text color="primary">閉じる</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISendVideoFileToKodiState from '@/model/state/recorded/detail/ISendVideoFileToKodiState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISendVideoFileSelectHostSettingStorageModel } from '@/model/storage/recorded/ISendVideoFileSelectHostSettingStorageModel';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../../api';

@Component({})
export default class SendVideoFileToKodiDialog extends Vue {
    @Prop({ required: true })
    public recordedItem!: apid.RecordedItem;

    @Prop({ required: true })
    public videoFiles!: apid.VideoFile[];

    @Prop({ required: true })
    public isOpen!: boolean;

    public dialogState = container.get<ISendVideoFileToKodiState>('ISendVideoFileToKodiState');
    public isRemove: boolean = false;

    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private setting = container.get<ISendVideoFileSelectHostSettingStorageModel>('ISendVideoFileSelectHostSettingStorageModel');

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

    public close(): void {
        this.dialogModel = false;
    }

    public async send(videoFileId: apid.VideoFileId): Promise<void> {
        try {
            await this.dialogState.send(videoFileId);
            this.snackbarState.open({
                color: 'success',
                text: '送信しました',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: '送信に失敗しました',
            });
        }
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && !!oldState === false) {
            const settingValue = this.setting.getSavedValue();
            this.dialogState.init(settingValue.hostName);
        } else if (newState === false && oldState === true) {
            // close
            this.setting.tmp.hostName = this.dialogState.hostName;
            this.setting.save();

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
}
</script>
