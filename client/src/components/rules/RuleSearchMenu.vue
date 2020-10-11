<template>
    <div>
        <v-menu v-model="isOpen" bottom left :close-on-content-click="false">
            <template v-slot:activator="{ on }">
                <v-btn dark icon v-on="on">
                    <v-icon>mdi-magnify</v-icon>
                </v-btn>
            </template>
            <v-card width="400">
                <div class="rule-search pa-4">
                    <v-text-field v-model="keyword" label="キーワード" clearable v-on:keydown.enter="onSearch()"></v-text-field>
                </div>
                <v-divider></v-divider>
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
import Util from '@/util/Util';
import { Component, Vue, Watch } from 'vue-property-decorator';

@Component({})
export default class RuleSearchMenu extends Vue {
    public isOpen: boolean = false;
    public keyword: string | null = '';

    public onCancel(): void {
        this.isOpen = false;
    }

    public onSearch(): void {
        this.isOpen = false;

        this.$nextTick(async () => {
            await Util.sleep(300);

            const searchQuery: any = {};
            if (typeof this.keyword !== 'undefined' && this.keyword !== null && this.keyword.length > 0) {
                searchQuery.keyword = this.keyword;
            }

            await Util.move(this.$router, {
                path: '/rule',
                query: searchQuery,
            });
        });
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
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && oldState === false) {
            // query から値をセット
            this.keyword = typeof this.$route.query.keyword === 'string' ? this.$route.query.keyword : '';
        }
    }
}
</script>

<style lang="sass">
.rule-search
    .v-input__control
        .v-input__slot
            margin: 0 !important
        .v-messages
            display: none
</style>
