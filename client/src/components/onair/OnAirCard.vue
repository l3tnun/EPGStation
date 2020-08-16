<template>
    <div class="on-air pa-2">
        <v-card v-if="items.length > 0" class="mx-auto pa-4" max-width="800">
            <div
                v-for="item in items"
                v-bind:key="item.display.channelId"
                v-on:click="openStreamSelector(item.schedule.channel)"
            >
                <div class="py-2" style="cursor: pointer;">
                    <div v-if="typeof item.display.logoSrc !== 'undefined'" class="d-flex align-center mb-1">
                        <img :src="item.display.logoSrc" height="24" class="pr-2" />
                        <div class="pt-1 subtitle-1 font-weight-black">{{ item.display.channelName }}</div>
                    </div>
                    <div v-else class="mb-1 subtitle-1 font-weight-black">{{ item.display.channelName }}</div>
                    <div class="caption font-weight-light">{{ item.display.time }}</div>
                    <div class="mb-1 subtitle-2">
                        {{ item.display.name }}
                    </div>
                    <div class="body-2 font-weight-light">{{ item.display.description }}</div>

                    <div class="pt-3">
                        <v-progress-linear buffer-value="100" :value="item.display.digestibility"></v-progress-linear>
                    </div>
                </div>
            </div>
        </v-card>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IOnAirSelectStreamState from '@/model/state/onair/IOnAirSelectStreamState';
import { OnAirDisplayData } from '@/model/state/onair/IOnAirState';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class OnAirCard extends Vue {
    @Prop({ required: true })
    public items!: OnAirDisplayData[];

    private streamSelectDialog: IOnAirSelectStreamState = container.get<IOnAirSelectStreamState>(
        'IOnAirSelectStreamState',
    );

    /**
     * ストリーム選択ダイアログを開く
     * @param channelItem: apid.ScheduleChannleItem
     */
    public openStreamSelector(channelItem: apid.ScheduleChannleItem): void {
        this.streamSelectDialog.open(channelItem);
    }
}
</script>
