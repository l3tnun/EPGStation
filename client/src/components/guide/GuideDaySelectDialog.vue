<template>
    <div class="guide-day-select-dialog">
        <v-dialog v-if="isRemove === false" v-model="dialogModel" max-width="150" scrollable>
            <v-card class="py-2">
                <v-list-item v-for="item in dayItems" :key="item.value" v-on:click="goto(item.value)" :disabled="item.disabled">
                    <v-list-item-content>
                        <v-list-item-title v-text="item.text" style="text-align: center"></v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import DateUtil from '@/util/DateUtil';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';

@Component({})
export default class GuideDaySelectDialog extends Vue {
    @Prop({ required: true })
    public isOpen!: boolean;

    public isRemove: boolean = false;
    public dayItems: {
        text: string;
        value: string;
        disabled: boolean;
    }[] = [];

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
     * 指定した時刻へ移動
     */
    public async goto(time: string): Promise<void> {
        this.dialogModel = false;

        const query: any = {
            time: time,
        };
        if (typeof this.$route.query.type === 'string') {
            query.type = this.$route.query.type;
        }
        if (typeof this.$route.query.channelId !== 'undefined') {
            query.channelId = this.$route.query.channelId;
        }

        await Util.move(this.$router, {
            path: '/guide',
            query: query,
        });
    }

    /**
     * dayItems の初期化
     */
    private initItem(): void {
        // 日付
        this.dayItems = [];
        const now = DateUtil.getJaDate(new Date());
        const hourStr = DateUtil.format(now, 'hh');
        let baseTime = new Date(DateUtil.format(now, 'yyyy/MM/dd 00:00:00 +0900')).getTime();

        const currentTime = typeof this.$route.query.time === 'string' ? this.$route.query.time : DateUtil.format(now, 'YYMMddhh');

        for (let i = 0; i < 8; i++) {
            const date = new Date(baseTime);
            const value = DateUtil.format(date, 'YYMMdd' + hourStr);
            this.dayItems.push({
                text: DateUtil.format(date, 'MM/dd(w)'),
                value: value,
                disabled: value === currentTime,
            });
            baseTime += 1000 * 60 * 60 * 24;
        }
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && oldState === false) {
            this.initItem();
        } else if (newState === false && oldState === true) {
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

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.dialogModel = false;
    }
}
</script>
