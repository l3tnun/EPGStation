<template>
    <div class="guide-genre-setting-dialog">
        <v-dialog v-if="isRemove === false" v-model="dialogModel" max-width="500" scrollable>
            <v-card>
                <v-card-text class="pa-4">
                    <div v-for="item in genreItems" :key="item.id" class="d-flex align-center" style="height: 48px">
                        <div class="body-1">{{ item.text }}</div>
                        <v-spacer></v-spacer>
                        <v-switch v-model="item.value"></v-switch>
                    </div>
                </v-card-text>
                <v-divider></v-divider>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn color="error" text v-on:click="dialogModel = false">キャンセル</v-btn>
                    <v-btn color="primary" text v-on:click="update">更新</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import { IGuideGenreSettingStorageModel } from '@/model/storage/guide/IGuideGenreSettingStorageModel';
import GenreUtil from '@/util/GenreUtil';
import Util from '@/util/Util';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';

@Component({})
export default class GuideGenreSettingDialog extends Vue {
    @Prop({ required: true })
    public isOpen!: boolean;

    public isRemove: boolean = false;

    public genreItems: {
        id: number;
        text: string;
        value: boolean;
    }[] = [];

    private genreSetting = container.get<IGuideGenreSettingStorageModel>('IGuideGenreSettingStorageModel');

    /**
     * Prop で受け取った isOpen を直接は書き換えられないので
     * getter, setter を用意する
     */
    get dialogModel(): boolean {
        return this.isOpen;
    }
    set dialogModel(value: boolean) {
        this.$emit('update:isOpen', value);
    }

    /**
     * ジャンル設定の反映
     */
    public update(): void {
        for (const genre of this.genreItems) {
            if (typeof (this.genreSetting.tmp as any)[genre.id] === 'undefined') {
                continue;
            }
            (this.genreSetting.tmp as any)[genre.id] = genre.value;
        }
        this.genreSetting.save();

        this.dialogModel = false;
        this.$emit('update');
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && oldState === false) {
            this.initItem();
        } else if (newState === false && oldState === true) {
            // close
            this.$nextTick(async () => {
                await Util.sleep(100);
                // dialog close アニメーションが終わったら要素を削除する
                this.isRemove = true;
                this.$nextTick(() => {
                    this.isRemove = false;
                });
            });
        }
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.dialogModel = false;
    }

    /**
     * genreItems の初期化
     */
    private initItem(): void {
        const savedValue = this.genreSetting.getSavedValue();

        this.genreItems = [];
        for (let i = 0; i < GenreUtil.GENRE_MAX_NUM; i++) {
            const text = GenreUtil.getGenre(i);
            if (text === null || typeof (savedValue as any)[i] === 'undefined') {
                continue;
            }

            const value = (savedValue as any)[i];
            this.genreItems.push({
                id: i,
                text: text,
                value: value,
            });
        }
    }
}
</script>

<style lang="sass" scoped>
.theme--light.v-card
    .v-card__text
        color: rgba(0, 0, 0, 0.87)
    .sub-text
        color: rgba(0, 0, 0, 0.54)
.theme--dark.v-card
    .v-card__text
        color: white

    .sub-text
        color: rgba(255, 255, 255, 0.7)

.encode-selector
    max-width: 120px
</style>
