<template>
    <div>
        <v-menu v-model="isOpened" bottom left>
            <template v-slot:activator="{ on }">
                <v-btn dark icon v-on="on">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list>
                <v-list-item v-on:click="openDownloadDialog">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-download</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>download</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
                <v-list-item v-if="typeof recordedItem.ruleId !== 'undefined'" v-on:click="gotoRule">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-calendar</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>rule</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
                <v-list-item v-on:click="search">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-magnify</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>search</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
                <v-list-item v-on:click="openDeleteDialog">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-delete</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>delete</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
            </v-list>
        </v-menu>
        <div v-if="isOpened === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
        <RecordedDownloadDialog
            :isOpen.sync="isOpenDownloadDialog"
            :recordedItem="recordedItem"
            v-on:download="downloadVideo"
            v-on:downloadPlayList="downloadPlayList"
        ></RecordedDownloadDialog>
        <RecordedDeleteDialog
            :isOpen.sync="isOpenDeleteDialog"
            :recordedItem="recordedItem"
            :isDelaySnackbarViewNum="800"
            v-on:deleteSiccessful="deleteSiccessful"
        ></RecordedDeleteDialog>
    </div>
</template>

<script lang="ts">
import RecordedDeleteDialog from '@/components/recorded/RecordedDeleteDialog.vue';
import RecordedDownloadDialog from '@/components/recorded/RecordedDownloadDialog.vue';
import Util from '@/util/Util';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../../api';

@Component({
    components: {
        RecordedDownloadDialog,
        RecordedDeleteDialog,
    },
})
export default class RecordedDetailMoreButton extends Vue {
    @Prop({ required: true })
    public recordedItem!: apid.RecordedItem;

    public isOpened: boolean = false;

    public isOpenDeleteDialog: boolean = false;
    public isOpenDownloadDialog: boolean = false;

    public async openDownloadDialog(): Promise<void> {
        await Util.sleep(300);
        this.isOpenDownloadDialog = true;
    }

    public async gotoRule(): Promise<void> {
        if (typeof this.recordedItem.ruleId === 'undefined') {
            return;
        }

        await Util.sleep(300);
        Util.move(this.$router, {
            path: '/search',
            query: {
                rule: this.recordedItem.ruleId.toString(10),
            },
        });
    }

    public async search(): Promise<void> {
        await Util.sleep(300);

        // TODO recorded 絞り込み
    }

    public async openDeleteDialog(): Promise<void> {
        await Util.sleep(300);
        this.isOpenDeleteDialog = true;
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }

    public deleteSiccessful(deleteSiccessful: boolean): void {
        if (deleteSiccessful === true) {
            this.$router.back();
        }
    }

    public downloadVideo(video: apid.VideoFile): void {
        this.$emit('download', video);
    }

    public downloadPlayList(video: apid.VideoFile): void {
        this.$emit('downloadPlayList', video);
    }
}
</script>
