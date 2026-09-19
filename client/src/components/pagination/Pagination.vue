<template>
    <div>
        <template v-if="isEnableExtendedPagination === true">
            <ExtendedPagination :pageSize="pageSize" :total="total"></ExtendedPagination>
        </template>
        <template v-else>
            <v-pagination
                v-if="total > pageSize"
                v-model="page"
                :circle="false"
                :length="totalPages"
                :total-visible="12"
                v-on:input="onMovePage"
                class="normal px-1"
            ></v-pagination>
            <div class="mobile">
                <MobilePagination :pageSize="pageSize" :total="total"></MobilePagination>
            </div>
        </template>
    </div>
</template>

<script lang="ts">
import ExtendedPagination from '@/components/pagination/ExtendedPagination.vue';
import MobilePagination from '@/components/pagination/MobilePagination.vue';
import Util from '@/util/Util';
import { cloneDeep } from 'lodash';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({
    components: {
        ExtendedPagination,
        MobilePagination,
    },
})
export default class Pagination extends Vue {
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

    // 拡張ページネーションを有効にするか (ルール一覧のみ)
    @Prop({
        default: false,
    })
    public isEnableExtendedPagination!: boolean;

    /**
     * pagination page
     */
    get page(): number {
        return Util.getPageNum(this.$route);
    }

    /**
     * pagination page
     */
    set page(value: number) {}

    get totalPages(): number {
        if (this.total === 0) {
            return 1;
        }

        return Math.ceil(this.total / this.pageSize);
    }

    /**
     * pagination 変更時呼ばれる
     */
    public onMovePage(newPage: number): void {
        const query = cloneDeep(this.$route.query);
        query.page = newPage.toString(10);

        Util.move(this.$router, {
            path: this.$route.path,
            query: query,
        });
    }
}
</script>

<style lang="sass" scoped>
$change-width: 500px

.normal
    display: block
.mobile
    display: none

@media screen and (max-width: $change-width)
    .normal
        display: none
    .mobile
        display: block
</style>
