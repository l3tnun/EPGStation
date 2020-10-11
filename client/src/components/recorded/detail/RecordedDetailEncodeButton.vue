<template>
    <div>
        <v-btn v-if="recordedItem.isRecording === false && serverConfig.isEnableEncode() === true" color="teal white--text" v-on:click="openEncodeDialog" class="ma-1">
            <v-icon left dark>mdi-plus-circle-outline</v-icon>
            encode
        </v-btn>
        <AddEncodeDialog :isOpen.sync="isOpenEncodeDialog" :recordedItem="recordedItem"></AddEncodeDialog>
    </div>
</template>

<script lang="ts">
import AddEncodeDialog from '@/components/encode/AddEncodeDialog.vue';
import container from '@/model/ModelContainer';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../../api';

@Component({
    components: {
        AddEncodeDialog,
    },
})
export default class RecordedDetailEncodeButton extends Vue {
    @Prop({ required: true })
    public recordedItem!: apid.RecordedItem;

    @Prop({ required: true })
    public videoFiles!: apid.VideoFile[];

    public serverConfig: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
    public isOpenEncodeDialog: boolean = false;

    public openEncodeDialog(): void {
        this.isOpenEncodeDialog = true;
    }
}
</script>
