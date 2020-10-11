<template>
    <div class="program-dialog">
        <v-dialog v-if="isRemove === false" v-model="dialogState.isOpen" max-width="500" scrollable>
            <v-card v-if="dialogState.displayData !== null">
                <v-card-text class="pa-4">
                    <div class="subtitle-1 font-weight-black mb-1">{{ dialogState.displayData.programName }}</div>
                    <div class="sub-text">{{ dialogState.displayData.channelName }}</div>
                    <div class="sub-text">{{ dialogState.displayData.time }}</div>
                    <div class="genres sub-text my-1">
                        <div v-for="genre in dialogState.displayData.genres" v-bind:key="genre">{{ genre }}</div>
                    </div>
                    <div v-if="typeof dialogState.displayData.description !== 'undefined'" class="description my-2">
                        {{ dialogState.displayData.description }}
                    </div>
                    <div v-if="typeof dialogState.displayData.extended !== 'undefined'" class="extended my-2" id="program-extended">
                        {{ dialogState.displayData.extended }}
                    </div>
                    <div class="typs sub-text my-1">
                        <div v-if="typeof dialogState.displayData.videoType !== 'undefined'">
                            {{ dialogState.displayData.videoType }}
                        </div>
                        <div v-if="typeof dialogState.displayData.audioType !== 'undefined'">
                            {{ dialogState.displayData.audioType }}
                        </div>
                        <div v-if="typeof dialogState.displayData.audioSamplingRate !== 'undefined'">
                            {{ dialogState.displayData.audioSamplingRate }}
                        </div>
                    </div>
                    <div class="sub-text">{{ dialogState.displayData.isFree === true ? '無料放送' : '有料放送' }}</div>
                </v-card-text>
                <v-divider></v-divider>
                <div class="pa-2 encode-action">
                    <div v-if="dialogState.reserve === null" class="overflow-x-hidden">
                        <div class="d-flex align-center justify-end">
                            <v-checkbox class="mx-1 my-0 pr-2" label="元ファイル削除" v-model="dialogSetting.tmp.isDeleteOriginalAfterEncode"></v-checkbox>
                            <v-select :items="dialogState.getEncodeList()" v-model="dialogSetting.tmp.encode" :menu-props="{ auto: true }" class="encode-selector"></v-select>
                        </div>
                    </div>
                    <div>
                        <div class="d-flex justify-end">
                            <!-- 閉じる -->
                            <v-btn color="blue darken-1" text v-on:click="dialogState.isOpen = false">閉じる</v-btn>
                            <!-- 詳細予約 or 手動予約編集 or ルール編集 -->
                            <v-btn v-if="dialogState.reserve === null" color="blue darken-1" text v-on:click="manualReserve">詳細</v-btn>
                            <v-btn v-else-if="typeof dialogState.reserve.ruleId !== 'undefined'" color="blue darken-1" text v-on:click="editRule">ルール</v-btn>
                            <v-btn v-else color="blue darken-1" text v-on:click="editManualReserve">編集</v-btn>
                            <!-- 検索 -->
                            <v-btn color="blue darken-1" text v-on:click="search">検索</v-btn>
                            <!-- 予約 or 削除 or 除外 or 除外解除 or 重複解除 -->
                            <v-btn v-if="dialogState.reserve === null" v-on:click="addReserve" color="blue darken-1" text>予約</v-btn>
                            <v-btn v-else-if="typeof dialogState.reserve.ruleId === 'undefined'" v-on:click="cancelReserve" color="blue darken-1" text>削除</v-btn>
                            <v-btn v-else-if="dialogState.reserve.type === 'skip'" v-on:click="removeReserveSkip" color="blue darken-1" text>除外解除</v-btn>
                            <v-btn v-else-if="dialogState.reserve.type === 'overlap'" v-on:click="removeReserveOverlap" color="blue darken-1" text>重複解除</v-btn>
                            <v-btn v-else color="blue darken-1" text v-on:click="cancelReserve">除外</v-btn>
                        </div>
                    </div>
                </div>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IGuideProgramDialogState from '@/model/state/guide/IGuideProgramDialogState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { IGuideProgramDialogSettingStorageModel } from '@/model/storage/guide/IGuideProgramDialogSettingStorageModel';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import StrUtil from '@/util/StrUtil';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';

@Component({})
export default class ProgramDialog extends Vue {
    public dialogState: IGuideProgramDialogState = container.get<IGuideProgramDialogState>('IGuideProgramDialogState');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private dialogSetting = container.get<IGuideProgramDialogSettingStorageModel>('IGuideProgramDialogSettingStorageModel');
    public isRemove: boolean = false;

    private snackbarState = container.get<ISnackbarState>('ISnackbarState');

    /**
     * 手動予約
     */
    public async manualReserve(): Promise<void> {
        const program = this.dialogState.getProgram();
        if (program === null) {
            return;
        }

        this.dialogState.isOpen = false;
        await Util.sleep(300);

        await Util.move(this.$router, {
            path: '/reserves/manual',
            query: {
                programId: program.id.toString(10),
            },
        });
    }

    /**
     * 手動予約編集
     */
    public async editManualReserve(): Promise<void> {
        if (this.dialogState.reserve === null) {
            return;
        }

        const reserveId = this.dialogState.reserve.reserveId;

        this.dialogState.isOpen = false;
        await Util.sleep(300);

        await Util.move(this.$router, {
            path: '/reserves/manual',
            query: {
                reserveId: reserveId.toString(10),
            },
        });
    }

    /**
     * ルール編集
     */
    public async editRule(): Promise<void> {
        if (this.dialogState.reserve === null || typeof this.dialogState.reserve.ruleId === 'undefined') {
            return;
        }

        const ruleId = this.dialogState.reserve.ruleId;

        this.dialogState.isOpen = false;
        await Util.sleep(300);

        await Util.move(this.$router, {
            path: '/search',
            query: {
                rule: ruleId.toString(10),
            },
        });
    }

    /**
     * 検索
     */
    public async search(): Promise<void> {
        this.dialogState.isOpen = false;
        await Util.sleep(300);

        // 検索用 query 生成
        const query: { [key: string]: string } = {};
        const program = this.dialogState.getProgram();
        if (program === null) {
            return;
        }

        const settingValue = this.setting.getSavedValue();

        query.keyword = StrUtil.createSearchKeyword(program.name);
        if (settingValue.isIncludeChannelIdWhenSearching === true) {
            query.channelId = program.channelId.toString(10);
        }

        if (settingValue.isIncludeGenreWhenSearching === true) {
            if (typeof program.genre1 !== 'undefined') {
                query.genre = program.genre1.toString(10);
                if (typeof program.subGenre1 !== 'undefined') {
                    query.subGenre = program.subGenre1.toString(10);
                }
            } else if (typeof program.genre2 !== 'undefined') {
                query.genre = program.genre2.toString(10);
                if (typeof program.subGenre2 !== 'undefined') {
                    query.subGenre = program.subGenre2.toString(10);
                }
            } else if (typeof program.genre3 !== 'undefined') {
                query.genre = program.genre3.toString(10);
                if (typeof program.subGenre3 !== 'undefined') {
                    query.subGenre = program.subGenre3.toString(10);
                }
            }
        }

        await Util.move(this.$router, {
            path: '/search',
            query: query,
        });
    }

    /**
     * 簡易手動予約
     */
    public async addReserve(): Promise<void> {
        try {
            await this.dialogState.addReserve();
            if (this.dialogState.displayData !== null) {
                this.snackbarState.open({
                    text: `${this.dialogState.displayData.programName} 予約`,
                });
            }
        } catch (err) {
            if (this.dialogState.displayData !== null) {
                this.snackbarState.open({
                    color: 'error',
                    text: `${this.dialogState.displayData.programName} 予約失敗`,
                });
            }
        }
        this.dialogState.isOpen = false;
    }

    /**
     * 予約キャンセル
     */
    public async cancelReserve(): Promise<void> {
        try {
            await this.dialogState.cancelReserve();
            if (this.dialogState.displayData !== null) {
                this.snackbarState.open({
                    text: `${this.dialogState.displayData.programName} キャンセル`,
                });
            }
        } catch (err) {
            if (this.dialogState.displayData !== null) {
                this.snackbarState.open({
                    color: 'error',
                    text: `${this.dialogState.displayData.programName} キャンセル失敗`,
                });
            }
        }
        this.dialogState.isOpen = false;
    }

    /**
     * 予約の除外状態解除
     */
    public async removeReserveSkip(): Promise<void> {
        try {
            await this.dialogState.removeReserveSkip();
            if (this.dialogState.displayData !== null) {
                this.snackbarState.open({
                    text: `${this.dialogState.displayData.programName} 除外解除`,
                });
            }
        } catch (err) {
            if (this.dialogState.displayData !== null) {
                this.snackbarState.open({
                    color: 'error',
                    text: `${this.dialogState.displayData.programName} 除外解除失敗`,
                });
            }
        }
        this.dialogState.isOpen = false;
    }

    /**
     * 予約の重複状態解除
     */
    public async removeReserveOverlap(): Promise<void> {
        try {
            if (this.dialogState.displayData !== null) {
                await this.dialogState.removeReserveOverlap();
                this.snackbarState.open({
                    text: `${this.dialogState.displayData.programName} 重複解除`,
                });
            }
        } catch (err) {
            if (this.dialogState.displayData !== null) {
                this.snackbarState.open({
                    color: 'error',
                    text: `${this.dialogState.displayData.programName} 重複解除失敗`,
                });
            }
        }
        this.dialogState.isOpen = false;
    }

    /**
     * dialog の表示状態が変更されたときに呼ばれる
     */
    @Watch('dialogState.isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        /**
         * dialog を一度開くと v-aplication 直下に要素が追加され、
         * android 使用時に番組表のスクロールが正常にできなくなる
         * そのため一時的に isRemove を true にして要素を削除し、再度描画させている
         */
        if (newState === false && oldState === true) {
            // close
            this.dialogSetting.save();

            this.$nextTick(async () => {
                await Util.sleep(100);
                this.isRemove = true;
                this.$nextTick(() => {
                    this.isRemove = false;
                    this.dialogState.close();
                });
            });
        } else if (newState === true && oldState === false) {
            // open
            // extended の URL のリンクを貼る
            this.$nextTick(() => {
                const extended = document.getElementById('program-extended');
                if (extended !== null) {
                    let str = extended.innerHTML;
                    str = str.replace(/(http:\/\/[\x21-\x7e]+)/gi, "<a href='$1' target='_blank'>$1</a>");
                    str = str.replace(/(https:\/\/[\x21-\x7e]+)/gi, "<a href='$1' target='_blank'>$1</a>");
                    extended.innerHTML = str;
                }
            });
        }
    }

    /**
     * ページ移動時
     */
    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        // ページ移動時にダイアログが開いていたら閉じる
        if (this.dialogState.isOpen === true) {
            this.dialogState.close();
        }
    }
}
</script>

<style lang="sass" scoped>
.theme--light.v-card
    .v-card__text
        color: rgba(0, 0, 0, 0.87)
    .sub-text
        color: rgba(0, 0, 0, 0.54)
.theme--dark.v-card
    .v-card__text
        color: white

    .sub-text
        color: rgba(255, 255, 255, 0.7)

.encode-selector
    max-width: 120px
</style>

<style lang="sass">
.v-card__text
    .description, .extended
        white-space: pre-wrap
</style>

<style lang="sass">
.encode-action
    .v-input__control
        .v-input__slot
            margin: 0 !important
        .v-messages
            display: none
</style>
