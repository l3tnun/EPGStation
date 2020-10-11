<template>
    <v-content>
        <TitleBar title="番組表設定"></TitleBar>
        <transition name="page">
            <div v-if="isShow" ref="appContent" class="app-content">
                <v-container>
                    <v-card class="mx-auto" max-width="800">
                        <div class="guide-size-setting">
                            <v-list-item three-line>
                                <v-list-item-content>
                                    <div class="title">通常表示</div>
                                    <div class="my-2 d-flex flex-row align-center">
                                        <div>
                                            <v-list-item-title class="subtitle-1">チャンネル高さ</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-select
                                            :items="channelHeightItems"
                                            v-model="storageModel.tmp.tablet.channelHeight"
                                            class="size-selector"
                                            :menu-props="{ auto: true }"
                                        ></v-select>
                                    </div>
                                    <div class="my-2 d-flex flex-row align-center">
                                        <div>
                                            <v-list-item-title class="subtitle-1">チャンネル横幅</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-select
                                            :items="channelWidthItems"
                                            v-model="storageModel.tmp.tablet.channelWidth"
                                            class="size-selector"
                                            :menu-props="{ auto: true }"
                                        ></v-select>
                                    </div>
                                    <div class="my-2 d-flex flex-row align-center">
                                        <div>
                                            <v-list-item-title class="subtitle-1">チャンネルフォント</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-select
                                            :items="fontSizeItems"
                                            v-model="storageModel.tmp.tablet.channelFontsize"
                                            class="size-selector"
                                            :menu-props="{ auto: true }"
                                        ></v-select>
                                    </div>
                                    <div class="my-2 d-flex flex-row align-center">
                                        <div>
                                            <v-list-item-title class="subtitle-1">時刻高さ</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-select
                                            :items="timeHeightItems"
                                            v-model="storageModel.tmp.tablet.timescaleHeight"
                                            class="size-selector"
                                            :menu-props="{ auto: true }"
                                        ></v-select>
                                    </div>
                                    <div class="my-2 d-flex flex-row align-center">
                                        <div>
                                            <v-list-item-title class="subtitle-1">時刻横幅</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-select
                                            :items="timeWidthItems"
                                            v-model="storageModel.tmp.tablet.timescaleWidth"
                                            class="size-selector"
                                            :menu-props="{ auto: true }"
                                        ></v-select>
                                    </div>
                                    <div class="my-2 d-flex flex-row align-center">
                                        <div>
                                            <v-list-item-title class="subtitle-1">時刻フォント</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-select
                                            :items="fontSizeItems"
                                            v-model="storageModel.tmp.tablet.timescaleFontsize"
                                            class="size-selector"
                                            :menu-props="{ auto: true }"
                                        ></v-select>
                                    </div>
                                    <div class="my-2 d-flex flex-row align-center">
                                        <div>
                                            <v-list-item-title class="subtitle-1">番組フォント</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-select
                                            :items="fontSizeItems"
                                            v-model="storageModel.tmp.tablet.programFontSize"
                                            class="size-selector"
                                            :menu-props="{ auto: true }"
                                        ></v-select>
                                    </div>
                                </v-list-item-content>
                            </v-list-item>

                            <v-list-item three-line>
                                <v-list-item-content>
                                    <div class="title">モバイル表示</div>
                                    <div class="my-2 d-flex flex-row align-center">
                                        <div>
                                            <v-list-item-title class="subtitle-1">チャンネル高さ</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-select
                                            :items="channelHeightItems"
                                            v-model="storageModel.tmp.mobile.channelHeight"
                                            class="size-selector"
                                            :menu-props="{ auto: true }"
                                        ></v-select>
                                    </div>
                                    <div class="my-2 d-flex flex-row align-center">
                                        <div>
                                            <v-list-item-title class="subtitle-1">チャンネル横幅</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-select
                                            :items="channelWidthItems"
                                            v-model="storageModel.tmp.mobile.channelWidth"
                                            class="size-selector"
                                            :menu-props="{ auto: true }"
                                        ></v-select>
                                    </div>
                                    <div class="my-2 d-flex flex-row align-center">
                                        <div>
                                            <v-list-item-title class="subtitle-1">チャンネルフォント</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-select
                                            :items="fontSizeItems"
                                            v-model="storageModel.tmp.mobile.channelFontsize"
                                            class="size-selector"
                                            :menu-props="{ auto: true }"
                                        ></v-select>
                                    </div>
                                    <div class="my-2 d-flex flex-row align-center">
                                        <div>
                                            <v-list-item-title class="subtitle-1">時刻高さ</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-select
                                            :items="timeHeightItems"
                                            v-model="storageModel.tmp.mobile.timescaleHeight"
                                            class="size-selector"
                                            :menu-props="{ auto: true }"
                                        ></v-select>
                                    </div>
                                    <div class="my-2 d-flex flex-row align-center">
                                        <div>
                                            <v-list-item-title class="subtitle-1">時刻横幅</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-select
                                            :items="timeWidthItems"
                                            v-model="storageModel.tmp.mobile.timescaleWidth"
                                            class="size-selector"
                                            :menu-props="{ auto: true }"
                                        ></v-select>
                                    </div>
                                    <div class="my-2 d-flex flex-row align-center">
                                        <div>
                                            <v-list-item-title class="subtitle-1">時刻フォント</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-select
                                            :items="fontSizeItems"
                                            v-model="storageModel.tmp.mobile.timescaleFontsize"
                                            class="size-selector"
                                            :menu-props="{ auto: true }"
                                        ></v-select>
                                    </div>
                                    <div class="my-2 d-flex flex-row align-center">
                                        <div>
                                            <v-list-item-title class="subtitle-1">番組フォント</v-list-item-title>
                                        </div>
                                        <v-spacer></v-spacer>
                                        <v-select
                                            :items="fontSizeItems"
                                            v-model="storageModel.tmp.mobile.programFontSize"
                                            class="size-selector"
                                            :menu-props="{ auto: true }"
                                        ></v-select>
                                    </div>
                                </v-list-item-content>
                            </v-list-item>
                        </div>
                        <v-card-actions right>
                            <v-spacer></v-spacer>
                            <v-btn text v-on:click="reset">リセット</v-btn>
                            <v-btn text color="primary" v-on:click="save">保存</v-btn>
                        </v-card-actions>
                    </v-card>
                </v-container>
            </div>
        </transition>
    </v-content>
</template>

<script lang="ts">
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { IGuideSizeSettingStorageModel } from '@/model/storage/guide/IGuideSizeSettingStorageModel';
import { ISettingStorageModel, GuideViewMode } from '@/model/storage/setting/ISettingStorageModel';
import { Component, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

interface SelectItem {
    text: string;
    value: number;
}

@Component({
    components: {
        TitleBar,
    },
})
export default class GuideSizeSetting extends Vue {
    public isShow: boolean = false;
    public storageModel = container.get<IGuideSizeSettingStorageModel>('IGuideSizeSettingStorageModel');

    public channelHeightItems: number[] = [];
    public channelWidthItems: number[] = [];
    public timeHeightItems: number[] = [];
    public timeWidthItems: number[] = [];
    public fontSizeItems: SelectItem[] = [];

    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    constructor() {
        super();

        for (let i = 0; i <= 600; i += 10) {
            this.channelWidthItems.push(i);
        }

        for (let i = 10; i <= 400; i += 10) {
            this.timeHeightItems.push(i);
        }

        for (let i = 10; i <= 100; i += 10) {
            this.channelHeightItems.push(i);
            this.timeWidthItems.push(i);
        }

        for (let i = 5; i <= 400; i += 5) {
            const value = i / 10;
            this.fontSizeItems.push({
                text: value.toFixed(1),
                value: value,
            });
        }
    }

    public beforeDestroy(): void {
        this.isShow = false;
    }

    public reset(): void {
        this.storageModel.tmp = this.storageModel.getDefaultValue();
    }

    public save(): void {
        this.storageModel.save();

        this.snackbarState.open({
            text: '保存されました',
            color: 'success',
        });
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.$nextTick(() => {
            this.isShow = true;

            this.$nextTick(async () => {
                // スクロール位置復元を許可
                await this.scrollState.emitDoneGetData();
            });
        });
    }
}
</script>

<style lang="sass" scoped>
.dummy
    visibility: hidden

.text
    max-width: 180px

.subtitle-1
    padding-right: 16px

.size-selector
    max-width: 100px
@media screen and (min-width: 600px)
    .guide-size-setting
        display: flex
</style>
