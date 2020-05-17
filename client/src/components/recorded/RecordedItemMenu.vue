<template>
    <div class="recorded-item-menu">
        <v-menu class="menu" v-model="isOpened" bottom left>
            <template v-slot:activator="{ on }">
                <v-btn icon class="menu-button" v-on="on">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list>
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
                <v-list-item v-if="serverConfig.isEnableEncode() === true" v-on:click="openEncodeDialog">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-plus-circle-outline</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>encode</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
                <v-list-item v-if="recordedItem.isEncoding === true" v-on:click="stopEncode">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-stop</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>stop</v-list-item-title>
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
        <AddEncodeDialog :isOpen.sync="isOpenEncodeDialog" :recordedItem="recordedItem"></AddEncodeDialog>
        <RecordedDeleteDialog :isOpen.sync="isOpenDeleteDialog" :recordedItem="recordedItem"></RecordedDeleteDialog>
    </div>
</template>

<script lang="ts">
import AddEncodeDialog from '@/components/encode/AddEncodeDialog.vue';
import RecordedDeleteDialog from '@/components/recorded/RecordedDeleteDialog.vue';
import container from '@/model/ModelContainer';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import Util from '@/util/Util';
import { Component, Prop, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({
    components: {
        AddEncodeDialog,
        RecordedDeleteDialog,
    },
})
export default class RecordedItemMenu extends Vue {
    @Prop({
        required: true,
    })
    public recordedItem!: apid.RecordedItem;

    public isOpened: boolean = false;
    public isOpenDeleteDialog: boolean = false;
    public isOpenEncodeDialog: boolean = false;

    public serverConfig: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');

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

    public async stopEncode(): Promise<void> {
        this.$emit('stopEncode', this.recordedItem.id);
    }

    public async openDeleteDialog(): Promise<void> {
        await Util.sleep(300);
        this.isOpenDeleteDialog = true;
    }

    public async openEncodeDialog(): Promise<void> {
        await Util.sleep(300);
        this.isOpenEncodeDialog = true;
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }
}
</script>

<style lang="sass" scoped>
.menu-background
    position: fixed
    top: 0
    left: 0
    width: 100%
    height: 100%
    z-index: 7 // vuetify アップデート毎に確認が必要
</style>
