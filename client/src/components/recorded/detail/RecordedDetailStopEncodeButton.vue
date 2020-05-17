<template>
    <v-btn v-if="recordedItem.isEncoding === true" color="teal white--text" v-on:click="stopEncode" class="ma-1">
        <v-icon left dark>mdi-stop</v-icon>
        stop
    </v-btn>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../../api';

@Component({})
export default class RecordedDetailStopEncodeButton extends Vue {
    @Prop({ required: true })
    public recordedItem!: apid.RecordedItem;

    public async stopEncode(): Promise<void> {
        this.$emit('stopEncode');
    }
}
</script>
