<template>
    <div class="wrap" v-bind:class="{ 'pt-4': typeof title !== 'undefined' }">
        <div
            class="title subtitle-2 font-weight-regular"
            v-bind:class="{
                required: !!required,
                'font-weight-bold': !!required,
            }"
        >
            {{ title }}
        </div>
        <div class="content">
            <slot></slot>
        </div>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({})
export default class SearchOptionRow extends Vue {
    @Prop({ required: false })
    public title!: string | undefined;

    @Prop({ required: false })
    public required!: boolean | undefined;
}
</script>

<style lang="sass">
@media screen and (min-width: 480px)
    .wrap
        display: flex
        .title
            width: 25%
            &.required
                color: red
                font: bold
        .content
            width: 75%
</style>
