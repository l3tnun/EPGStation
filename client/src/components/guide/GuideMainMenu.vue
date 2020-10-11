<template>
    <div class="reserves-main-menu">
        <v-menu class="menu" v-model="isOpened" bottom left>
            <template v-slot:activator="{ on }">
                <v-btn icon class="menu-button" v-on="on">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list>
                <v-list-item v-on:click="updateReserves">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-update</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>予約情報更新</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
                <v-list-item v-on:click="genreSetting">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-bookmark</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>表示ジャンル</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>

                <v-list-item v-on:click="gotoSetting">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-cog</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>表示設定</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
            </v-list>
        </v-menu>
        <GuideGenreSettingDialog :isOpen.sync="isOpenGenreSettingDialog" v-on:update="onUpdateGenreSetting"></GuideGenreSettingDialog>
        <div v-if="isOpened === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
    </div>
</template>

<script lang="ts">
import GuideGenreSettingDialog from '@/components/guide/GuideGenreSettingDialog.vue';
import IReservesApiModel from '@/model/api/reserves/IReservesApiModel';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import { Component, Vue } from 'vue-property-decorator';

@Component({
    components: {
        GuideGenreSettingDialog,
    },
})
export default class GuideMainMenu extends Vue {
    public isOpened: boolean = false;
    public isOpenGenreSettingDialog: boolean = false;

    private reservesApiModel: IReservesApiModel = container.get<IReservesApiModel>('IReservesApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public async updateReserves(): Promise<void> {
        this.isOpened = false;

        try {
            await this.reservesApiModel.updateAll();
            this.snackbarState.open({
                text: '予約情報の更新開始',
            });
        } catch (err) {
            this.snackbarState.open({
                color: 'error',
                text: '予約情報の更新を開始できませんでした。',
            });
        }
    }

    public async genreSetting(): Promise<void> {
        this.isOpened = false;
        await Util.sleep(300);
        this.isOpenGenreSettingDialog = true;
    }

    public onUpdateGenreSetting(): void {
        this.$emit('updatedgenre');
    }

    public async gotoSetting(): Promise<void> {
        await Util.move(this.$router, {
            path: '/guide/setting',
        });
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }
}
</script>
