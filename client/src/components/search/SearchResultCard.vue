<template>
    <v-card class="my-2" :class="program.display.reserveType" v-on:click="openDetail">
        <v-list-item three-line>
            <v-list-item-content>
                <div class="subtitle-1 font-weight-black">{{ program.display.name }}</div>
                <div class="subtitle-2 font-weight-light">{{ program.display.channelName }}</div>
                <div class="caption font-weight-light mb-2">
                    {{ program.display.day }}({{ program.display.dow }}) {{ program.display.startTime }} ~ {{ program.display.endTime }} ({{ program.display.duration }}分)
                </div>
                <div class="body-2 grey--text text--darken-2">{{ program.display.description }}</div>
            </v-list-item-content>
        </v-list-item>
    </v-card>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IGuideProgramDialogState from '@/model/state/guide/IGuideProgramDialogState';
import { SearchResultItem } from '@/model/state/search/ISearchState';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class SearchResultCard extends Vue {
    @Prop({ required: true })
    public program!: SearchResultItem;

    private dialogState: IGuideProgramDialogState = container.get<IGuideProgramDialogState>('IGuideProgramDialogState');

    public openDetail(): void {
        this.dialogState.open({
            channel: this.program.channel,
            program: this.program.program,
            reserve: this.program.reserve,
        });
    }
}
</script>

<style lang="sass" scoped>

.reserve
    border: 4px solid red
.conflict
    background-color: #fffd6b
    border: 4px solid red
    border-style: dashed
.skip
    background-color: #aaa
.overlap
    text-decoration: line-through
    background-color: #aaa
    color: black
</style>
