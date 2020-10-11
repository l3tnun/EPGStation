<template>
    <div class="on-air pa-2">
        <v-card v-if="items.length > 0" class="mx-auto pa-4" max-width="800">
            <div v-for="item in items" v-bind:key="item.display.channelId" v-on:click="openStreamSelector(item.schedule.channel)">
                <div class="py-2" style="cursor: pointer">
                    <div v-if="typeof item.display.logoSrc !== 'undefined'" v-on:click="openGuideProgramDialog(item.schedule, $event)" class="d-flex align-center mb-1">
                        <img :src="item.display.logoSrc" height="24" class="pr-2" />
                        <div class="pt-1 subtitle-1 font-weight-black">{{ item.display.channelName }}</div>
                    </div>
                    <div v-else v-on:click="openGuideProgramDialog(item.schedule, $event)" class="mb-1 subtitle-1 font-weight-black">
                        {{ item.display.channelName }}
                    </div>
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
import IGuideProgramDialogState, { ProgramDialogOpenOption } from '@/model/state/guide/IGuideProgramDialogState';
import { ReserveStateItemIndex } from '@/model/state/guide/IGuideReserveUtil';
import IOnAirSelectStreamState from '@/model/state/onair/IOnAirSelectStreamState';
import { OnAirDisplayData } from '@/model/state/onair/IOnAirState';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class OnAirCard extends Vue {
    @Prop({ required: true })
    public items!: OnAirDisplayData[];

    @Prop({ required: true })
    public reserveIndex!: ReserveStateItemIndex;

    private streamSelectDialog: IOnAirSelectStreamState = container.get<IOnAirSelectStreamState>('IOnAirSelectStreamState');
    private dialogState: IGuideProgramDialogState = container.get<IGuideProgramDialogState>('IGuideProgramDialogState');

    public openGuideProgramDialog(schedule: apid.Schedule, e: Event): void {
        e.stopPropagation();

        const option: ProgramDialogOpenOption = {
            channel: schedule.channel,
            program: schedule.programs[0],
        };
        if (typeof this.reserveIndex[schedule.programs[0].id] !== 'undefined') {
            option.reserve = {
                type: this.reserveIndex[schedule.programs[0].id].type,
                reserveId: this.reserveIndex[schedule.programs[0].id].item.reserveId,
                ruleId: this.reserveIndex[schedule.programs[0].id].item.ruleId,
            };
        }

        this.dialogState.open(option);
    }

    /**
     * ストリーム選択ダイアログを開く
     * @param channelItem: apid.ScheduleChannleItem
     */
    public openStreamSelector(channelItem: apid.ScheduleChannleItem): void {
        this.streamSelectDialog.open(channelItem);
    }
}
</script>
