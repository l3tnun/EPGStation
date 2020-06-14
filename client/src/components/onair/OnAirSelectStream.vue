<template>
    <div class="on-ari-select-stream">
        <v-dialog v-if="isRemove === false" v-model="dialogState.isOpen" max-width="400" scrollable>
            <v-card v-if="dialogState.getChannelItem() !== null">
                <div class="pa-4">
                    <div>{{ dialogState.getChannelItem().name }}</div>
                    <div class="d-flex">
                        <v-select
                            :items="dialogState.getStreamTypes()"
                            v-model="dialogState.selectedStreamType"
                            v-on:change="updateStreamConfig"
                            class="guide-time"
                            style="max-width: 120px;"
                            :menu-props="{ auto: true }"
                        ></v-select>
                        <v-select
                            v-if="isHiddenStreamConfig === false"
                            :items="dialogState.streamConfigItems"
                            v-model="dialogState.selectedStreamConfig"
                            class="guide-time"
                            :menu-props="{ auto: true }"
                        ></v-select>
                    </div>
                </div>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn color="primary" text v-on:click="dialogState.isOpen = false">キャンセル</v-btn>
                    <v-btn color="primary" text v-on:click="view">視聴</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import IOnAirSelectStreamState from '../../model/state/onair/IOnAirSelectStreamState';
import Util from '../../util/Util';

@Component({})
export default class OnAirSelectStream extends Vue {
    public dialogState: IOnAirSelectStreamState = container.get<IOnAirSelectStreamState>('IOnAirSelectStreamState');
    public isRemove: boolean = false;
    // ストリーム設定セレクタ再描画用
    public isHiddenStreamConfig: boolean = false;

    public beforeDestroy(): void {
        this.dialogState.close();
    }

    public updateStreamConfig(): void {
        this.dialogState.updateStreamConfig();

        // ストリーム設定セレクタ再描画
        this.isHiddenStreamConfig = true;
        this.$nextTick(() => {
            this.isHiddenStreamConfig = false;
        });
    }

    /**
     * 視聴する
     */
    public view(): void {}

    /**
     * dialog の表示状態が変更されたときに呼ばれる
     */
    @Watch('dialogState.isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === false && oldState === true) {
            // close
            this.$nextTick(async () => {
                await Util.sleep(100);
                this.isRemove = true;
                this.$nextTick(() => {
                    this.isRemove = false;
                    this.dialogState.close();
                });
            });
        }
    }
}
</script>
