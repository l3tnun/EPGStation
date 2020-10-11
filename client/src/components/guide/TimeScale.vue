<template>
    <div class="time-scale">
        <div class="white--text item" v-bind:class="getItemClass(time)" v-for="time in guideState.getTimes()" v-bind:key="time">
            {{ time }}
        </div>
        <div class="item dummy">dummy</div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IGuideState from '@/model/state/guide/IGuideState';
import { Component, Vue } from 'vue-property-decorator';

@Component({})
export default class TimeScale extends Vue {
    public guideState: IGuideState = container.get<IGuideState>('IGuideState');

    /**
     * item class
     * @return {}
     */
    public getItemClass(time: number): any {
        const result: any = {};
        result[`time-${time.toString(10)}`] = true;

        return result;
    }
}
</script>

<style lang="sass" scoped>
.time-scale
    .item
        min-width: var(--timescale-width)
        max-width: var(--timescale-width)
        width: var(--timescale-width)
        min-height: var(--timescale-height)
        max-height: var(--timescale-height)
        height: var(--timescale-height)
        font-size: var(--timescale-fontsize)
        font-weight: bold
        display: flex
        justify-content: center
        padding-top: 8px
        box-sizing: border-box
        border-top: 1px solid white
        border-bottom: 1px solid white

    .item.dummy
        visibility: hidden

    .time-4
        background: #98c32f
    .time-5
        background: #b4c831
    .time-6
        background: #d1cc34
    .time-7
        background: #efcc35
    .time-8
        background: #ffcd3e
    .time-9
        background: #ffc636
    .time-10
        background: #feaf33
    .time-11
        background: #fe9c30
    .time-12
        background: #fe882f
    .time-13
        background: #fe7b2d
    .time-14
        background: #fe712c
    .time-15
        background: #fd692b
    .time-16
        background: #fd5f25
    .time-17
        background: #fd572b
    .time-18
        background: #f44c3c
    .time-19
        background: #e33f6e
    .time-20
        background: #ce35a2
    .time-21
        background: #b630d9
    .time-22
        background: #9e2ffc
    .time-23
        background: #852ffc
    .time-0
        background: #652ffc
    .time-1
        background: #3f2cf3
    .time-2
        background: #2923d5
    .time-3
        background: #2520c0
</style>
