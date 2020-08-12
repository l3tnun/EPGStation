<template>
    <div class="on-air pa-2">
        <v-card v-if="items.length > 0" class="mx-auto" max-width="800">
            <div
                v-for="(item, i) in items"
                v-bind:key="item.display.channelId"
                v-on:click="openStreamSelector(item.schedule.channel)"
            >
                <v-list-item three-line style="cursor: pointer;">
                    <v-list-item-content>
                        <div class="subtitle-1 font-weight-black">{{ item.display.channelName }}</div>
                        <div class="caption font-weight-light">{{ item.display.time }}</div>
                        <div class="subtitle-2">
                            {{ item.display.name }}
                        </div>
                        <div class="body-2 font-weight-light">{{ item.display.description }}</div>
                    </v-list-item-content>
                </v-list-item>
                <v-divider v-if="i < items.length - 1"></v-divider>
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
