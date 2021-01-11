<template>
    <v-dialog v-if="isRemove === false" v-model="dialogModel" max-width="500" scrollable>
        <v-card>
            <div class="pa-3 pt-4 pb-0 add-encode">
                <div class="subtitle-1">{{ recordedItem.name }}</div>
                <div class="d-flex">
                    <v-select :items="addEncodeState.getVideoFiles()" v-model="addEncodeState.videoFileId" label="source" :menu-props="{ auto: true }" class="source"></v-select>
                    <v-select :items="addEncodeState.getEncodeList()" v-model="addEncodeState.encodeMode" label="preset" :menu-props="{ auto: true }" class="preset"></v-select>
                </div>

                <div class="directory">
                    <v-select
                        :items="addEncodeState.getParentDirectoryList()"
                        v-model="addEncodeState.parentDirectory"
                        label="recorded"
                        :menu-props="{ auto: true }"
                        :disabled="addEncodeState.isSaveSameDirectory === true"
                        class="parent"
                    ></v-select>
                    <v-text-field
                        v-model="addEncodeState.directory"
                        label="sub directory"
                        clearable
                        :disabled="addEncodeState.isSaveSameDirectory === true"
                        class="sub"
                    ></v-text-field>
                </div>

                <v-checkbox v-model="setting.tmp.isSaveSameDirectory" class="mx-1 my-0" label="元ファイルを同じ場所に保存する"></v-checkbox>
                <v-checkbox v-model="setting.tmp.removeOriginal" class="mx-1 my-0" label="元ファイルを削除する"></v-checkbox>
            </div>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn v-on:click="cancel" text color="error">キャンセル</v-btn>
                <v-btn v-on:click="add" text color="primary">追加</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IAddEncodeState from '@/model/state/encode/IAddEncodeState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { IAddEncodeSettingStorageModel } from '@/model/storage/encode/IAddEncodeSettingStorageModel';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class AddEncodeDialog extends Vue {
    @Prop({ required: true })
    public recordedItem!: apid.RecordedItem;

    @Prop({ required: true })
    public isOpen!: boolean;

    public addEncodeState = container.get<IAddEncodeState>('IAddEncodeState');
    public setting: IAddEncodeSettingStorageModel = container.get<IAddEncodeSettingStorageModel>('IAddEncodeSettingStorageModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public isRemove: boolean = false;

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

    public cancel(): void {
        this.dialogModel = false;
    }

    public async add(): Promise<void> {
        this.dialogModel = false;

        try {
            await this.addEncodeState.addEncode();
            this.snackbarState.open({
                color: 'success',
                text: 'エンコード追加',
            });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'エンコード追加に失敗しました',
            });
        }
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && !!oldState === false) {
            const settingValue = this.setting.getSavedValue();
            this.addEncodeState.init(
                this.recordedItem.id,
                typeof this.recordedItem.videoFiles === 'undefined' ? [] : this.recordedItem.videoFiles,
                settingValue.encodeMode,
                settingValue.parentDirectory,
            );
        } else if (newState === false && oldState === true) {
            // close
            this.setting.tmp.encodeMode = this.addEncodeState.encodeMode;
            this.setting.tmp.parentDirectory = this.addEncodeState.parentDirectory;
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

<style lang="sass" scoped>
.add-encode
    .source
        flex-basis: 35%
    .preset
        flex-basis: 65%

    @media screen and (min-width: 400px)
        .directory
            display: flex
            align-items: center
        .parent
            flex-basis: 35%
        .sub
            flex-basis: 65%
</style>

<style lang="sass">
.add-encode
    .v-input__control
        .v-input__slot
            margin: 0 !important
        .v-messages
            display: none
</style>
