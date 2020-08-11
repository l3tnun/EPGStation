<template>
    <div>
        <v-menu v-model="isOpen" bottom left :close-on-content-click="false">
            <template v-slot:activator="{ on }">
                <v-btn dark icon v-on="on">
                    <v-icon>mdi-magnify</v-icon>
                </v-btn>
            </template>
            <v-card>
                <div>search content</div>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn v-on:click="onCancel" text color="error">閉じる</v-btn>
                    <v-btn v-on:click="onSearch" text color="primary">検索</v-btn>
                </v-card-actions>
            </v-card>
        </v-menu>
        <div v-if="isOpen === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IRecordedSearchState from '@/model/state/recorded/search/IRecordedSearchState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

@Component({})
export default class RecordedSearchMenu extends Vue {
    public isOpen: boolean = false;
    public searchState: IRecordedSearchState = container.get<IRecordedSearchState>('IRecordedSearchState');

    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private onUpdateStatusCallback = (async () => {
        await this.searchState.update().catch(err => {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: '録画検索オプションの取得に失敗',
            });
        });
    }).bind(this);

    public created(): void {
        // socket.io イベント
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        // socket.io イベント
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
    }

    public onCancel(): void {
        this.isOpen = false;
    }

    public onSearch(): void {
        this.isOpen = false;
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }

    /**
     * ページ移動時
     */
    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.isOpen = false;

        this.searchState.fetchData().catch(err => {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: '録画検索オプションの取得に失敗',
            });
        });
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && oldState === false) {
            this.searchState.initValues();
        }
    }
}
</script>

<style lang="sass" scoped>
.menu-background
    position: fixed
    top: 0
    left: 0
    width: 100%
    height: 100vh
    z-index: 7 // vuetify アップデート毎に確認が必要
</style>
