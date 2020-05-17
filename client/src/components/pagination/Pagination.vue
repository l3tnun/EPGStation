<template>
    <v-pagination
        v-if="total > pageSize"
        v-model="page"
        :circle="false"
        :length="totalPages"
        :total-visible="10"
        v-on:input="onMovePage"
    ></v-pagination>
</template>

<script lang="ts">
import Util from '@/util/Util';
import { cloneDeep } from 'lodash';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({})
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
