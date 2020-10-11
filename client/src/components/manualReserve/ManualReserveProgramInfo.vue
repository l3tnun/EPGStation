<template>
    <div v-if="program !== null" class="manual-reserve-program-info">
        <v-card>
            <div class="pa-4">
                <div class="subtitle-1 font-weight-black mb-1">{{ program.display.name }}</div>
                <div class="body-2 font-weight-light">{{ program.display.channelName }}</div>
                <div class="body-2 font-weight-light">
                    {{ program.display.day }}({{ program.display.dow }}) {{ program.display.startTime }} ~ {{ program.display.endTime }} ({{ program.display.duration }}m)
                </div>
                <div class="genres body-2 font-weight-light my-1">
                    <div v-for="genre in program.display.genres" v-bind:key="genre">{{ genre }}</div>
                </div>
                <div v-if="typeof program.display.description !== 'undefined'" class="description body-1 font-weight-regular my-2">
                    {{ program.display.description }}
                </div>
                <div v-if="typeof program.display.extended !== 'undefined'" class="extended body-1 font-weight-regular my-2" ref="extended">
                    {{ program.display.extended }}
                </div>
                <div class="typs body-2 font-weight-light my-1">
                    <div v-if="typeof program.display.videoType !== 'undefined'">
                        {{ program.display.videoType }}
                    </div>
                    <div v-if="typeof program.display.audioType !== 'undefined'">
                        {{ program.display.audioType }}
                    </div>
                    <div v-if="typeof program.display.audioSamplingRate !== 'undefined'">
                        {{ program.display.audioSamplingRate }}
                    </div>
                </div>
                <div class="body-2 font-weight-light">
                    {{ program.display.isFree === true ? '無料放送' : '有料放送' }}
                </div>
            </div>
        </v-card>
    </div>
</template>

<script lang="ts">
import { ProgramStateData } from '@/model/state/reserve/manual/IManualReserveState';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({})
export default class ManualReserveProgramInfo extends Vue {
    @Prop({ required: true })
    public program!: ProgramStateData | null;
}
</script>
