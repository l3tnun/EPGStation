<template>
    <div class="dash-board-item pa-1">
        <v-card class="item-content d-flex flex-column">
            <div class="subtitle-1 pa-4 item-title">
                <div v-on:click="onClickBage">
                    {{ title }}
                    <v-badge v-if="bage > 0" bordered color="pink" :content="bage" class="pl-1"></v-badge>
                </div>
            </div>
            <div class="content overflow-auto" ref="content" v-on:scroll="onScroll">
                <slot name="items"></slot>
            </div>
        </v-card>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({})
export default class DashboardItem extends Vue {
    @Prop({ required: true })
    public title!: string;

    @Prop()
    public bage: number | undefined;

    public onScroll(e: Event): void {
        this.$emit('scroll', e);
    }

    /**
     * スクロール位置をセットする
     */
    public setScrollTop(scrollTop: number): void {
        if (typeof this.$refs.content === 'undefined') {
            return;
        }

        (this.$refs.content as HTMLElement).scrollTop = scrollTop;
    }

    public onClickBage(e: Event): void {
        console.log('click bage');
        if (typeof this.bage !== 'undefined' && this.bage > 0) {
            this.$emit('bage', e);
        }
    }
}
</script>

<style lang="sass" scoped>
.dash-board-item, .item-content
    width: 100%
    max-height: 100%
    .item-title
        cursor: default
        user-select: none
    .content
        max-height: 100%
</style>
