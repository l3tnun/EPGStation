<template>
    <div class="channels d-flex" v-bind:class="{ isDark: $vuetify.theme.dark === true }">
        <div class="item dummy">dummy</div>
        <div class="white--text item" v-for="channel in channelItems" v-bind:key="channel.index" v-on:click="onClick(channel.item)">
            {{ channel.name }}
        </div>
        <div class="item scrollbar">dummy</div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IGuideState from '@/model/state/guide/IGuideState';
import IOnAirSelectStreamState from '@/model/state/onair/IOnAirSelectStreamState';
import DateUtil from '@/util/DateUtil';
import Util from '@/util/Util';
import { Component, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';

interface DisplayChannelItem {
    name: string;
    id: apid.ChannelId;
    index: number | string;
    item: apid.ScheduleChannleItem;
}

@Component({})
export default class Channel extends Vue {
    public guideState: IGuideState = container.get<IGuideState>('IGuideState');

    private streamSelectDialog: IOnAirSelectStreamState = container.get<IOnAirSelectStreamState>('IOnAirSelectStreamState');

    get channelItems(): DisplayChannelItem[] {
        if (typeof this.$route.query.channelId === 'undefined') {
            return this.guideState.getChannels().map(c => {
                return {
                    name: c.name,
                    id: c.id,
                    index: c.id,
                    item: c,
                };
            });
        } else {
            let baseTime = this.guideState.getStartAt();

            return this.guideState.getChannels().map(c => {
                const name = DateUtil.format(DateUtil.getJaDate(new Date(baseTime)), 'MM/dd(w)');
                baseTime += 60 * 60 * 24 * 1000;

                return {
                    name: name,
                    id: c.id,
                    index: name,
                    item: c,
                };
            });
        }
    }

    public async onClick(item: apid.ScheduleChannleItem): Promise<void> {
        // 単局表示の場合は何もしない
        if (typeof this.$route.query.channelId !== 'undefined') {
            return;
        }

        this.streamSelectDialog.open(item);
    }
}
</script>

<style lang="sass" scoped>
$board-line: 1px solid #ccc
$board-line-dark: 1px solid #888888

.channels
    .item
        min-width: var(--channel-width)
        max-width: var(--channel-width)
        width: var(--channel-width)
        min-height: var(--channel-height)
        max-height: var(--channel-height)
        height: var(--channel-height)
        font-size: var(--channel-fontsize)
        font-weight: bold
        cursor: pointer
        overflow: hidden
        white-space: nowrap
        display: flex
        justify-content: center
        align-items: center
        background: #999
        box-sizing: border-box
        border-left: $board-line
        border-right: $board-line

    .item.dummy
        min-width: var(--timescale-width)
        max-width: var(--timescale-width)
        width: var(--timescale-width)
        visibility: hidden

    .item.scrollbar
        visibility: hidden

    &.isDark
        .item
            background: #393e46
            border-left: $board-line-dark
            border-right: $board-line-dark
</style>
