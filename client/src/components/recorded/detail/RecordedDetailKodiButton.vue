<template>
    <div>
        <v-btn
            v-if="recordedItem.isRecording === false && serverConfig.isEnableSendVideoFileLinkToKodi() === true"
            color="teal white--text"
            v-on:click="openKodiDialog"
            class="ma-1"
        >
            <v-icon left dark>mdi-cast</v-icon>
            kodi
        </v-btn>
        <SendVideoFileToKodiDialog :isOpen.sync="isOpenKodiDialog" :recordedItem="recordedItem" :videoFiles="videoFiles"></SendVideoFileToKodiDialog>
    </div>
</template>

<script lang="ts">
import SendVideoFileToKodiDialog from '@/components/recorded/detail/SendVideoFileToKodiDialog.vue';
import container from '@/model/ModelContainer';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../../api';

@Component({
    components: {
        SendVideoFileToKodiDialog,
    },
})
export default class RecordedDetailKodiButton extends Vue {
    @Prop({ required: true })
    public recordedItem!: apid.RecordedItem;

    @Prop({ required: true })
    public videoFiles!: apid.VideoFile[];

    public serverConfig: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');
    public isOpenKodiDialog: boolean = false;

    public openKodiDialog(): void {
        this.isOpenKodiDialog = true;
    }
}
</script>
