<template>
    <div class="reserves-main-menu">
        <v-menu class="menu" v-model="isOpened" bottom left>
            <template v-slot:activator="{ on }">
                <v-btn icon class="menu-button" v-on="on">
                    <v-icon>mdi-dots-vertical</v-icon>
                </v-btn>
            </template>
            <v-list>
                <v-list-item v-on:click="edit">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-pencil</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>編集</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>

                <v-list-item v-on:click="updateReserves">
                    <v-list-item-icon class="mr-3">
                        <v-icon>mdi-update</v-icon>
                    </v-list-item-icon>
                    <v-list-item-content>
                        <v-list-item-title>予約情報更新</v-list-item-title>
                    </v-list-item-content>
                </v-list-item>
            </v-list>
        </v-menu>
        <div v-if="isOpened === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
    </div>
</template>

<script lang="ts">
import IReservesApiModel from '@/model/api/reserves/IReservesApiModel';
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Vue } from 'vue-property-decorator';

@Component({})
export default class ReservesMainMenu extends Vue {
    public isOpened: boolean = false;

    private reservesApiModel: IReservesApiModel = container.get<IReservesApiModel>('IReservesApiModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public edit(): void {
        this.$emit('edit');
    }

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

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }
}
</script>
