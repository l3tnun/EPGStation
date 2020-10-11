<template>
    <v-card>
        <div class="pa-4 manual-reserve-option">
            <v-expansion-panels :value.sync="manualReserveState.optionPanel" accordion multiple flat class="option-panels">
                <v-expansion-panel>
                    <v-expansion-panel-header>オプション</v-expansion-panel-header>
                    <v-expansion-panel-content>
                        <SearchOptionRow>
                            <div class="d-flex flex-wrap">
                                <v-checkbox class="mx-1 my-0" v-model="manualReserveState.reserveOption.allowEndLack" label="状況に応じて末尾がかけることを許可"></v-checkbox>
                            </div>
                        </SearchOptionRow>
                    </v-expansion-panel-content>
                </v-expansion-panel>
                <v-expansion-panel>
                    <v-expansion-panel-header>ディレクトリ</v-expansion-panel-header>
                    <v-expansion-panel-content>
                        <SearchOptionRow>
                            <v-select
                                class="directory"
                                v-model="manualReserveState.saveOption.parentDirectoryName"
                                :items="manualReserveState.getPrentDirectoryItems()"
                                label="directory"
                                clearable
                                :menu-props="{ auto: true }"
                            ></v-select>
                            <v-text-field v-model="manualReserveState.saveOption.directory" label="sub directory" clearable></v-text-field>
                        </SearchOptionRow>
                    </v-expansion-panel-content>
                </v-expansion-panel>
                <v-expansion-panel>
                    <v-expansion-panel-header>ファイル名形式</v-expansion-panel-header>
                    <v-expansion-panel-content>
                        <SearchOptionRow>
                            <v-text-field v-model="manualReserveState.saveOption.recordedFormat" label="file format" clearable></v-text-field>
                        </SearchOptionRow>
                    </v-expansion-panel-content>
                </v-expansion-panel>
                <v-expansion-panel v-if="manualReserveState.isEnableEncodeMode() === true">
                    <v-expansion-panel-header>エンコード1</v-expansion-panel-header>
                    <v-expansion-panel-content>
                        <SearchOptionRow>
                            <v-select
                                class="encode-mode"
                                v-model="manualReserveState.encodeOption.mode1"
                                :items="manualReserveState.getEncodeModeItems()"
                                label="mode1"
                                clearable
                                :menu-props="{ auto: true }"
                            ></v-select>
                            <v-select
                                class="directory"
                                v-model="manualReserveState.encodeOption.encodeParentDirectoryName1"
                                :items="manualReserveState.getPrentDirectoryItems()"
                                label="directory1"
                                clearable
                                :menu-props="{ auto: true }"
                            ></v-select>
                            <v-text-field v-model="manualReserveState.encodeOption.directory1" label="sub directory1" clearable></v-text-field>
                        </SearchOptionRow>
                    </v-expansion-panel-content>
                </v-expansion-panel>
                <v-expansion-panel v-if="manualReserveState.isEnableEncodeMode() === true">
                    <v-expansion-panel-header>エンコード2</v-expansion-panel-header>
                    <v-expansion-panel-content>
                        <SearchOptionRow>
                            <v-select
                                class="encode-mode"
                                v-model="manualReserveState.encodeOption.mode2"
                                :items="manualReserveState.getEncodeModeItems()"
                                label="mode2"
                                clearable
                                :menu-props="{ auto: true }"
                            ></v-select>
                            <v-select
                                class="directory"
                                v-model="manualReserveState.encodeOption.encodeParentDirectoryName2"
                                :items="manualReserveState.getPrentDirectoryItems()"
                                label="directory2"
                                clearable
                                :menu-props="{ auto: true }"
                            ></v-select>
                            <v-text-field v-model="manualReserveState.encodeOption.directory2" label="sub directory2" clearable></v-text-field>
                        </SearchOptionRow>
                    </v-expansion-panel-content>
                </v-expansion-panel>
                <v-expansion-panel v-if="manualReserveState.isEnableEncodeMode() === true">
                    <v-expansion-panel-header>エンコード3</v-expansion-panel-header>
                    <v-expansion-panel-content>
                        <SearchOptionRow>
                            <v-select
                                class="encode-mode"
                                v-model="manualReserveState.encodeOption.mode3"
                                :items="manualReserveState.getEncodeModeItems()"
                                label="mode3"
                                clearable
                                :menu-props="{ auto: true }"
                            ></v-select>
                            <v-select
                                class="directory"
                                v-model="manualReserveState.encodeOption.encodeParentDirectoryName3"
                                :items="manualReserveState.getPrentDirectoryItems()"
                                label="directory3"
                                clearable
                                :menu-props="{ auto: true }"
                            ></v-select>
                            <v-text-field v-model="manualReserveState.encodeOption.directory3" label="sub directory3" clearable></v-text-field>
                        </SearchOptionRow>
                    </v-expansion-panel-content>
                </v-expansion-panel>
                <v-expansion-panel v-if="manualReserveState.isEnableEncodeMode() === true">
                    <v-expansion-panel-header>ファイル削除</v-expansion-panel-header>
                    <v-expansion-panel-content>
                        <SearchOptionRow>
                            <v-checkbox class="mx-1 my-0" v-model="manualReserveState.encodeOption.isDeleteOriginalAfterEncode" label="元ファイルの自動削除"></v-checkbox>
                        </SearchOptionRow>
                    </v-expansion-panel-content>
                </v-expansion-panel>
            </v-expansion-panels>
        </div>
        <v-divider></v-divider>
        <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn text color="error" v-on:click="cancel">キャンセル</v-btn>
            <v-btn v-if="isEditMode === false" text color="primary" v-on:click="add">追加</v-btn>
            <v-btn v-else text color="primary" v-on:click="update">更新</v-btn>
        </v-card-actions>
    </v-card>
</template>

<script lang="ts">
import SearchOptionRow from '@/components/search/SearchOptionRow.vue';
import container from '@/model/ModelContainer';
import IManualReserveState from '@/model/state/reserve/manual/IManualReserveState';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({
    components: {
        SearchOptionRow,
    },
})
export default class ManualReserveOption extends Vue {
    @Prop({ required: true })
    public isEditMode!: boolean;

    private manualReserveState: IManualReserveState = container.get<IManualReserveState>('IManualReserveState');

    public cancel(): void {
        this.$emit('cancel');
    }

    public add(): void {
        this.$emit('add');
    }

    public update(): void {
        this.$emit('update');
    }
}
</script>

<style lang="sass" scoped>
.manual-reserve-option
    .directory
        max-width: 150px
    .option-panels
        .v-expansion-panel-header
            padding: 6px 0
            min-height: 38px
        .v-expansion-panel-content__wrap
            padding: 0
</style>

<style lang="sass">
.manual-reserve-option
    .v-input__control
        .v-input__slot
            margin: 0 !important
        .v-messages
            display: none
</style>
