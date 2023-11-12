<template>
    <v-card class="mx-auto" max-width="800">
        <div class="pa-4">
            <SearchOptionRow title="放送局※" :required="true">
                <v-select label="channel" :items="uploadState.getChannelItems()" v-model="uploadState.programOption.channelId" clearable :menu-props="{ auto: true }"></v-select>
            </SearchOptionRow>
            <SearchOptionRow title="ジャンル">
                <div class="d-flex">
                    <v-select
                        label="genre"
                        :items="uploadState.getGenreItems()"
                        v-model="uploadState.programOption.genre1"
                        clearable
                        :menu-props="{ auto: true }"
                        style="width: 50%"
                    ></v-select>
                    <v-select
                        label="sub genre"
                        :items="uploadState.getSubGenreItems()"
                        v-model="uploadState.programOption.subGenre1"
                        clearable
                        :menu-props="{ auto: true }"
                        style="width: 50%"
                    ></v-select>
                </div>
            </SearchOptionRow>
            <SearchOptionRow title="ルール">
                <v-autocomplete
                    v-model="uploadState.programOption.ruleId"
                    :loading="ruleLoading"
                    :items="uploadState.ruleItems"
                    :search-input.sync="ruleSearchInput"
                    item-text="keyword"
                    item-value="id"
                    cache-items
                    flat
                    hide-no-data
                    hide-details
                    clearable
                    label="ルール"
                    class="pb-2"
                ></v-autocomplete>
            </SearchOptionRow>
            <SearchOptionRow title="日付※" :required="true">
                <v-datetime-picker
                    v-if="uploadState.isShowPeriod === true"
                    label="開始"
                    clearText="クリア"
                    okText="設定"
                    v-model="uploadState.programOption.startAt"
                    :datePickerProps="{
                        locale: 'jp-ja',
                        'day-format': date => new Date(date).getDate(),
                        'first-day-of-week': 1,
                    }"
                    :timePickerProps="{
                        'ampm-in-title': true,
                    }"
                    :textFieldProps="{
                        color: 'success',
                    }"
                >
                    <template slot="actions" slot-scope="{ parent }">
                        <v-btn text color="primary" @click.native="parent.clearHandler">クリア</v-btn>
                        <v-btn text color="primary" @click="parent.okHandler">設定</v-btn>
                    </template>
                </v-datetime-picker>
            </SearchOptionRow>
            <SearchOptionRow title="長さ※" :required="true">
                <v-text-field v-model.number="uploadState.programOption.duration" min="1" label="長さ(分)" type="number" clearable></v-text-field>
            </SearchOptionRow>
            <SearchOptionRow title="番組名※" :required="true">
                <v-text-field v-model="uploadState.programOption.name" label="name" clearable></v-text-field>
            </SearchOptionRow>
            <SearchOptionRow title="概要">
                <v-textarea label="description" v-model="uploadState.programOption.description"></v-textarea>
            </SearchOptionRow>
            <SearchOptionRow title="詳細">
                <v-textarea label="extended" v-model="uploadState.programOption.extended"></v-textarea>
            </SearchOptionRow>
            <div v-for="video in uploadState.videoFileItems" v-bind:key="video.key">
                <SearchOptionRow :title="`ビデオファイル${video.key + 1}`">
                    <v-text-field v-model="video.viewName" label="name" clearable class="view-name"></v-text-field>
                    <v-select class="file-type" v-model="video.fileType" :items="uploadState.getFileTypeItems()" label="file type" :menu-props="{ auto: true }"></v-select>

                    <v-select
                        class="directory"
                        v-model="video.parentDirectoryName"
                        :items="uploadState.getPrentDirectoryItems()"
                        label="directory"
                        :menu-props="{ auto: true }"
                    ></v-select>
                    <v-text-field v-model="video.subDirectory" label="sub directory" clearable></v-text-field>
                    <v-file-input v-model="video.file" label="video file"></v-file-input>
                </SearchOptionRow>
            </div>
        </div>
        <v-divider></v-divider>
        <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn v-on:click="reset" text color="error">リセット</v-btn>
            <v-btn v-on:click="upload" text color="primary">アップロード</v-btn>
        </v-card-actions>
    </v-card>
</template>

<script lang="ts">
import SearchOptionRow from '@/components/search/SearchOptionRow.vue';
import container from '@/model/ModelContainer';
import IRecordedUploadState from '@/model/state/recorded/upload/IRecordedUploadState';
import { Component, Vue, Watch } from 'vue-property-decorator';

@Component({
    components: {
        SearchOptionRow,
    },
})
export default class RecordedUploadForm extends Vue {
    public uploadState: IRecordedUploadState = container.get<IRecordedUploadState>('IRecordedUploadState');
    public ruleLoading: boolean = false;
    public ruleSearchInput: string | null = null;

    @Watch('ruleSearchInput', { immediate: true })
    public async onChangeSearch(newKeyword: string): Promise<void> {
        if (newKeyword === null || newKeyword === this.uploadState.ruleKeyword) {
            return;
        }

        this.uploadState.ruleKeyword = newKeyword;
        await this.uploadState.updateRuleItems();
    }

    public reset(): void {
        this.$emit('reset');
    }

    public upload(): void {
        this.$emit('upload');
    }
}
</script>

<style lang="sass" scoped>
.view-name, .file-type, .directory
    max-width: 150px
</style>
