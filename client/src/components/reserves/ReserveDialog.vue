<template>
    <div class="reserve-dialog">
        <v-dialog v-if="isRemove === false" v-model="dialogModel" max-width="500" scrollable>
            <v-card v-if="reserve !== null">
                <v-card-text class="pa-4 pb-2">
                    <div class="subtitle-1 font-weight-black mb-1">{{ reserve.display.name }}</div>
                    <div class="sub-text">{{ reserve.display.channelName }}</div>
                    <div class="sub-text" style="cursor: pointer" v-on:click="gotoGuide">
                        {{ reserve.display.day }}({{ reserve.display.dow }}) {{ reserve.display.startTime }} ~ {{ reserve.display.endTime }} ({{ reserve.display.duration }}m)
                    </div>
                    <div class="genres sub-text my-1">
                        <div v-for="genre in reserve.display.genres" v-bind:key="genre">{{ genre }}</div>
                    </div>
                    <div class="description my-2">{{ reserve.display.description }}</div>
                    <div v-if="typeof reserve.display.extended !== 'undefined'" class="extended my-2" id="reserve-extended">
                        {{ reserve.display.extended }}
                    </div>
                </v-card-text>
                <div class="pa-2">
                    <div class="d-flex justify-end">
                        <v-btn color="blue darken-1" text v-on:click="dialogModel = false">閉じる</v-btn>
                    </div>
                </div>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import IChannelModel from '@/model/channels/IChannelModel';
import container from '@/model/ModelContainer';
import { ReserveStateData } from '@/model/state/reserve/IReserveStateUtil';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import DateUtil from '@/util/DateUtil';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';

@Component({})
export default class ReserveDialog extends Vue {
    @Prop({ required: true })
    public isOpen!: boolean;

    @Prop({
        required: true,
    })
    public reserve!: ReserveStateData | null;

    public isRemove: boolean = false;

    private settingModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private channelModel: IChannelModel = container.get<IChannelModel>('IChannelModel');

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

    /**
     * 番組の開始時間の番組表へ飛ぶ
     * @return Promise<void>
     */
    public async gotoGuide(): Promise<void> {
        if (this.reserve === null) {
            return;
        }

        this.dialogModel = false;
        await Util.sleep(300);

        const startAt = DateUtil.getJaDate(new Date(this.reserve.reserveItem.startAt));
        const query: any = {
            time: DateUtil.format(startAt, 'YYMMddhh'),
        };

        const setting = this.settingModel.getSavedValue();
        if (setting.isEnableDisplayForEachBroadcastWave === true) {
            const channel = this.channelModel.findChannel(this.reserve.reserveItem.channelId, true);
            if (channel !== null) {
                query.type = channel.channelType;
            }
        }

        await Util.move(this.$router, {
            path: '/guide',
            query: query,
        });
    }

    /**
     * dialog の表示状態が変更されたときに呼ばれる
     */
    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        /**
         * dialog を一度開くと v-aplication 直下に要素が追加され、
         * android 使用時に番組表のスクロールが正常にできなくなる
         * そのため一時的に isRemove を true にして要素を削除し、再度描画させている
         */
        if (newState === false && oldState === true) {
            // close
            this.$nextTick(async () => {
                await Util.sleep(100);
                this.isRemove = true;
                this.$nextTick(() => {
                    this.isRemove = false;
                });
            });
        } else if (newState === true && oldState === false) {
            // open
            // extended の URL のリンクを貼る
            this.$nextTick(() => {
                const extended = document.getElementById('reserve-extended');
                if (extended !== null) {
                    let str = extended.innerHTML;
                    str = str.replace(/(http:\/\/[\x21-\x7e]+)/gi, "<a href='$1' target='_blank'>$1</a>");
                    str = str.replace(/(https:\/\/[\x21-\x7e]+)/gi, "<a href='$1' target='_blank'>$1</a>");
                    extended.innerHTML = str;
                }
            });
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
</style>

<style lang="sass">
.v-card__text
    .description, .extended
        white-space: pre-wrap
</style>
