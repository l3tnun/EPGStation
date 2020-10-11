<template>
    <div v-if="pages.length > 0" class="pagination d-flex justify-center">
        <v-btn v-bind:class="{ disabled: currentPage === pages[0] }" :color="color" v-on:click="onMovePage(currentPage - 1)" class="my-2 mx-2">
            <v-icon dark>mdi-chevron-left</v-icon>
        </v-btn>
        <v-btn :color="page === currentPage ? 'primary' : color" v-for="page in pages" v-bind:key="page" v-on:click="onMovePage(page)" class="my-2 mx-1">
            {{ page }}
        </v-btn>
        <v-btn v-bind:class="{ disabled: currentPage === totalPages }" :color="color" v-on:click="onMovePage(currentPage + 1)" class="my-2 mx-2">
            <v-icon dark>mdi-chevron-right</v-icon>
        </v-btn>
    </div>
</template>

<script lang="ts">
import Util from '@/util/Util';
import { cloneDeep } from 'lodash';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import { Route } from 'vue-router';

@Component({})
class MobilePagination extends Vue {
    // 1 ページごとの最大表示件数
    @Prop({
        required: true,
    })
    public pageSize!: number;

    // 総件数
    @Prop({
        required: true,
    })
    public total!: number;

    public currentPage: number = 1;
    public pages: number[] = [];

    get totalPages(): number {
        if (this.total === 0) {
            return 1;
        }

        return Math.ceil(this.total / this.pageSize);
    }

    get color(): string {
        return this.$vuetify.theme.dark === true ? '' : 'white';
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        const maxPage = Math.ceil(this.total / this.pageSize);
        this.currentPage = typeof this.$route.query.page !== 'string' ? 1 : parseInt(this.$route.query.page, 10);
        if (maxPage === 1 || this.currentPage > maxPage) {
            this.pages = [];

            return;
        }

        // ページ番号生成
        let startPage =
            this.currentPage <= MobilePagination.PAGINATION_CENTER - 1
                ? 1
                : maxPage - this.currentPage >= MobilePagination.PAGINATION_CENTER - 1
                ? this.currentPage - (MobilePagination.PAGINATION_CENTER - 1)
                : maxPage - MobilePagination.PAGINATION_MAX_SIZE + 1;
        if (startPage <= 0) {
            startPage = 1;
        }

        // pages クリア
        this.pages.splice(-this.pages.length);
        for (let i = 0; i < MobilePagination.PAGINATION_MAX_SIZE; i++) {
            if (i + startPage > maxPage) {
                break;
            }
            this.pages.push(i + startPage);
        }
    }

    /**
     * pagination 変更時呼ばれる
     */
    public onMovePage(newPage: number): void {
        if (this.currentPage === newPage || newPage <= 0 || newPage > this.totalPages) {
            return;
        }

        const query = cloneDeep(this.$route.query);
        query.page = newPage.toString(10);

        Util.move(this.$router, {
            path: this.$route.path,
            query: query,
        });
    }
}

namespace MobilePagination {
    export const PAGINATION_MAX_SIZE = 5;
    export const PAGINATION_CENTER = Math.ceil(PAGINATION_MAX_SIZE / 2);
}

export default MobilePagination;
</script>

<style lang="sass" scoped>
.pagination
    .v-btn
        width: 36px
        min-width: 36px
    .disabled
        pointer-events: none
        color: rgb(167 167 167)
</style>
