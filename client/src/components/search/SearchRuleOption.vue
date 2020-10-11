<template>
    <div v-if="searchState.getSearchResult() !== null || searchState.isTimeSpecification === true" class="search-rule-option">
        <v-card class="mx-auto" max-width="800">
            <div class="pa-4">
                <v-expansion-panels :value.sync="searchState.optionPanel" accordion multiple flat class="option-panels">
                    <v-expansion-panel>
                        <v-expansion-panel-header>オプション</v-expansion-panel-header>
                        <v-expansion-panel-content>
                            <SearchOptionRow>
                                <div class="d-flex flex-wrap">
                                    <v-checkbox class="mx-1 my-0" v-model="searchState.reserveOption.enable" label="有効"></v-checkbox>
                                    <v-checkbox class="mx-1 my-0" v-model="searchState.reserveOption.allowEndLack" label="状況に応じて末尾がかけることを許可"></v-checkbox>
                                </div>
                            </SearchOptionRow>
                        </v-expansion-panel-content>
                    </v-expansion-panel>
                    <v-expansion-panel>
                        <v-expansion-panel-header>重複</v-expansion-panel-header>
                        <v-expansion-panel-content>
                            <SearchOptionRow>
                                <v-text-field class="period" v-model="searchState.reserveOption.periodToAvoidDuplicate" min="0" label="日数" type="number" clearable></v-text-field>
                                <v-checkbox class="mx-1 my-0" v-model="searchState.reserveOption.avoidDuplicate" label="録画済み番組を排除"></v-checkbox>
                            </SearchOptionRow>
                        </v-expansion-panel-content>
                    </v-expansion-panel>
                    <v-expansion-panel>
                        <v-expansion-panel-header>ディレクトリ</v-expansion-panel-header>
                        <v-expansion-panel-content>
                            <SearchOptionRow>
                                <v-select
                                    class="directory"
                                    v-model="searchState.saveOption.parentDirectoryName"
                                    :items="searchState.getPrentDirectoryItems()"
                                    label="directory"
                                    clearable
                                    :menu-props="{ auto: true }"
                                ></v-select>
                                <v-text-field v-model="searchState.saveOption.directory" label="sub directory" clearable></v-text-field>
                            </SearchOptionRow>
                        </v-expansion-panel-content>
                    </v-expansion-panel>
                    <v-expansion-panel>
                        <v-expansion-panel-header>ファイル名形式</v-expansion-panel-header>
                        <v-expansion-panel-content>
                            <SearchOptionRow>
                                <v-text-field v-model="searchState.saveOption.recordedFormat" label="file format" clearable></v-text-field>
                            </SearchOptionRow>
                        </v-expansion-panel-content>
                    </v-expansion-panel>
                    <v-expansion-panel v-if="searchState.isEnableEncodeMode() === true">
                        <v-expansion-panel-header>エンコード1</v-expansion-panel-header>
                        <v-expansion-panel-content>
                            <SearchOptionRow>
                                <v-select
                                    class="encode-mode"
                                    v-model="searchState.encodeOption.mode1"
                                    :items="searchState.getEncodeModeItems()"
                                    label="mode1"
                                    clearable
                                    :menu-props="{ auto: true }"
                                ></v-select>
                                <v-select
                                    class="directory"
                                    v-model="searchState.encodeOption.encodeParentDirectoryName1"
                                    :items="searchState.getPrentDirectoryItems()"
                                    label="directory1"
                                    clearable
                                    :menu-props="{ auto: true }"
                                ></v-select>
                                <v-text-field v-model="searchState.encodeOption.directory1" label="sub directory1" clearable></v-text-field>
                            </SearchOptionRow>
                        </v-expansion-panel-content>
                    </v-expansion-panel>
                    <v-expansion-panel v-if="searchState.isEnableEncodeMode() === true">
                        <v-expansion-panel-header>エンコード2</v-expansion-panel-header>
                        <v-expansion-panel-content>
                            <SearchOptionRow>
                                <v-select
                                    class="encode-mode"
                                    v-model="searchState.encodeOption.mode2"
                                    :items="searchState.getEncodeModeItems()"
                                    label="mode2"
                                    clearable
                                    :menu-props="{ auto: true }"
                                ></v-select>
                                <v-select
                                    class="directory"
                                    v-model="searchState.encodeOption.encodeParentDirectoryName2"
                                    :items="searchState.getPrentDirectoryItems()"
                                    label="directory2"
                                    clearable
                                    :menu-props="{ auto: true }"
                                ></v-select>
                                <v-text-field v-model="searchState.encodeOption.directory2" label="sub directory2" clearable></v-text-field>
                            </SearchOptionRow>
                        </v-expansion-panel-content>
                    </v-expansion-panel>
                    <v-expansion-panel v-if="searchState.isEnableEncodeMode() === true">
                        <v-expansion-panel-header>エンコード3</v-expansion-panel-header>
                        <v-expansion-panel-content>
                            <SearchOptionRow>
                                <v-select
                                    class="encode-mode"
                                    v-model="searchState.encodeOption.mode3"
                                    :items="searchState.getEncodeModeItems()"
                                    label="mode3"
                                    clearable
                                    :menu-props="{ auto: true }"
                                ></v-select>
                                <v-select
                                    class="directory"
                                    v-model="searchState.encodeOption.encodeParentDirectoryName3"
                                    :items="searchState.getPrentDirectoryItems()"
                                    label="directory3"
                                    clearable
                                    :menu-props="{ auto: true }"
                                ></v-select>
                                <v-text-field v-model="searchState.encodeOption.directory3" label="sub directory3" clearable></v-text-field>
                            </SearchOptionRow>
                        </v-expansion-panel-content>
                    </v-expansion-panel>
                    <v-expansion-panel v-if="searchState.isEnableEncodeMode() === true">
                        <v-expansion-panel-header>ファイル削除</v-expansion-panel-header>
                        <v-expansion-panel-content>
                            <SearchOptionRow>
                                <v-checkbox class="mx-1 my-0" v-model="searchState.encodeOption.isDeleteOriginalAfterEncode" label="元ファイルの自動削除"></v-checkbox>
                            </SearchOptionRow>
                        </v-expansion-panel-content>
                    </v-expansion-panel>
                </v-expansion-panels>
            </div>
            <v-divider></v-divider>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn v-on:click="onClickCancel" text color="error">キャンセル</v-btn>
                <v-btn v-if="this.searchState.isEditingRule() === true" v-on:click="onClickUpdate" text color="primary">更新</v-btn>
                <v-btn v-else v-on:click="onClickAdd" text color="primary">追加</v-btn>
            </v-card-actions>
        </v-card>
    </div>
</template>

<script lang="ts">
import SearchOptionRow from '@/components/search/SearchOptionRow.vue';
import container from '@/model/ModelContainer';
import ISearchState from '@/model/state/search/ISearchState';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({
    components: {
        SearchOptionRow,
    },
})
export default class SearchRuleOption extends Vue {
    public searchState: ISearchState = container.get<ISearchState>('ISearchState');

    public onClickCancel(): void {
        this.$emit('cancel');
    }

    public onClickAdd(): void {
        this.$emit('add');
    }

    public onClickUpdate(): void {
        this.$emit('update');
    }
}
</script>

<style lang="sass" scoped>
.search-rule-option
    .period
        max-width: 90px
    .directory
        max-width: 150px
    .encode-mode
        max-width: 150px
    .option-panels
        .v-expansion-panel-header
            padding: 6px 0
            min-height: 38px
        .v-expansion-panel-content__wrap
            padding: 0
</style>

<style lang="sass">
.search-rule-option
    .v-input__control
        .v-input__slot
            margin: 0 !important
        .v-messages
            display: none
</style>
