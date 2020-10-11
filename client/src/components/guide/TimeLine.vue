<template>
    <div class="time-line" v-bind:style="style">now</div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IGuideState from '@/model/state/guide/IGuideState';
import DateUtil from '@/util/DateUtil';
import { Component, Vue, Watch } from 'vue-property-decorator';

@Component({})
export default class TimeScale extends Vue {
    get style(): any {
        return {
            top: this.position <= 0 ? '-100px' : `calc((${this.position} * (var(--timescale-height) / 60)) - ${this.position === 0 ? 0 : 1}px)`,
        };
    }

    private guideState: IGuideState = container.get<IGuideState>('IGuideState');
    private timerId: number | null = null;
    private position: number = -100;

    public mounted(): void {
        // 次のタイマーをセット
        const loop = (): void => {
            this.timerId = setTimeout(() => {
                this.updatePosition();
                loop();
            }, this.getTimerNum());
        };
        loop();
    }

    private getTimerNum(): number {
        return (60 - new Date().getSeconds()) * 1000;
    }

    public destroyed(): void {
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
        }
    }

    /**
     * 時刻線位置を更新する
     */
    private updatePosition(): void {
        const now = new Date().getTime();
        const startAt = this.getStartAt();
        this.position = now < startAt ? 0 : Math.floor((now - startAt) / 1000 / 60);
    }

    /**
     * query から番組表開始時刻を取得する
     */
    private getStartAt(): number {
        const timeStr = typeof this.$route.query.time !== 'undefined' ? (this.$route.query.time as string) : DateUtil.format(DateUtil.getJaDate(new Date()), 'YYMMddhh');

        return new Date(`20${timeStr.substr(0, 2)}/${timeStr.substr(2, 2)}/${timeStr.substr(4, 2)} ${timeStr.substr(6, 2)}:00:00 +0900`).getTime();
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.updatePosition();
    }
}
</script>

<style lang="sass" scoped>
.time-line
    position: absolute
    background-color: red
    width: 100%
    height: 2px
    overflow: hidden
    z-index: 4
</style>
