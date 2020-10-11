<template>
    <div>
        <v-menu v-model="isOpen" bottom left :close-on-content-click="false">
            <template v-slot:activator="{ on }">
                <v-btn dark icon v-on="on">
                    <v-icon>mdi-clock-outline</v-icon>
                </v-btn>
            </template>
            <v-card>
                <div class="guide-time-selector pa-2">
                    <div class="d-flex">
                        <v-select v-if="broadcastItems.length > 0" :items="broadcastItems" v-model="broadcastValue" :menu-props="{ auto: true }" class="broadcast"></v-select>
                        <v-select :items="dayItems" v-model="dayValue" :menu-props="{ auto: true }" class="day"></v-select>
                        <v-select :items="hourItems" v-model="hourValue" :menu-props="{ auto: true }" class="hour"></v-select>
                    </div>
                </div>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn v-on:click="onCancel" text color="error">閉じる</v-btn>
                    <v-btn v-on:click="onShow" text color="primary">表示</v-btn>
                </v-card-actions>
            </v-card>
        </v-menu>
        <div v-if="isOpen === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import IGuideState from '@/model/state/guide/IGuideState';
import { ISettingStorageModel, ISettingValue } from '@/model/storage/setting/ISettingStorageModel';
import DateUtil from '@/util/DateUtil';
import Util from '@/util/Util';
import { Component, Vue, Watch } from 'vue-property-decorator';

@Component({})
export default class GuideTimeSelector extends Vue {
    public broadcastItems: string[] = [];
    public broadcastValue: string | undefined = undefined;
    public dayItems: {
        text: string;
        value: string;
    }[] = [];
    public dayValue: string | undefined;
    public hourItems: {
        text: string;
        value: string;
    }[] = [];
    public hourValue: string | undefined;

    public isOpen: boolean = false;

    private guideState: IGuideState = container.get<IGuideState>('IGuideState');
    private serverConfig: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private settingValue: ISettingValue | null = null;

    constructor() {
        super();

        for (let i = 0; i < 24; i++) {
            this.hourItems.push({
                text: `${i.toString(10)}時`,
                value: ('00' + i.toString(10)).slice(-2),
            });
        }
    }

    public onCancel(): void {
        this.isOpen = false;
    }

    public async onShow(): Promise<void> {
        this.isOpen = false;
        if (typeof this.dayValue === 'undefined' || typeof this.hourValue === 'undefined') {
            return;
        }

        const query: any = {
            time: this.dayValue + this.hourValue,
        };
        if (typeof this.broadcastValue !== 'undefined') {
            query.type = this.broadcastValue;
        }
        if (typeof this.$route.query.channelId !== 'undefined') {
            query.channelId = this.$route.query.channelId;
        }

        await Util.move(this.$router, {
            path: '/guide',
            query: query,
        });
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }

    /**
     * ページ移動時
     */
    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.isOpen = false;

        this.initItem();
        this.initValue();
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && oldState === false) {
            this.initValue();
        }
    }

    /**
     * selector item の初期化
     */
    private initItem(): void {
        this.settingValue = this.setting.getSavedValue();
        const config = this.serverConfig.getConfig();
        if (config === null) {
            console.error('config is null');
            throw new Error('ConfigIsNull');
        }

        // 放送波 item 設定
        this.broadcastItems = [];
        if (this.settingValue.isEnableDisplayForEachBroadcastWave === true) {
            if (config.broadcast.GR === true) {
                this.broadcastItems.push('GR');
            }
            if (config.broadcast.BS === true) {
                this.broadcastItems.push('BS');
            }
            if (config.broadcast.CS === true) {
                this.broadcastItems.push('CS');
            }
            if (config.broadcast.SKY === true) {
                this.broadcastItems.push('SKY');
            }
        }

        // 日付
        this.dayItems = [];
        const now = DateUtil.getJaDate(new Date());
        let baseTime = new Date(DateUtil.format(now, 'yyyy/MM/dd 00:00:00 +0900')).getTime();
        for (let i = 0; i < 8; i++) {
            const date = new Date(baseTime);
            this.dayItems.push({
                text: DateUtil.format(date, 'MM/dd(w)'),
                value: DateUtil.format(date, 'YYMMdd'),
            });
            baseTime += 1000 * 60 * 60 * 24;
        }
    }

    /**
     * selector value 初期化
     */
    private initValue(): void {
        if (this.settingValue !== null && this.settingValue.isEnableDisplayForEachBroadcastWave === true && typeof this.$route.query.type === 'string') {
            this.broadcastValue = this.$route.query.type;
        }

        this.dayValue = typeof this.$route.query.time === 'string' ? this.$route.query.time.substr(0, 6) : this.dayItems[0].value;

        this.hourValue = typeof this.$route.query.time === 'string' ? this.$route.query.time.substr(6, 2) : DateUtil.format(DateUtil.getJaDate(new Date()), 'hh');
    }
}
</script>

<style lang="sass" scoped>
.guide-time-selector
    .broadcast
        width: 70px
    .day
        width: 110px
    .hour
        width: 70px
</style>

<style lang="sass">
.guide-time-selector
    .v-input__control
        .v-input__slot
            margin: 0 !important
        .v-messages, .v-text-field__details
            display: none
</style>
