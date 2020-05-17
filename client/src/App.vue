<template>
    <div id="app">
        <AppContent></AppContent>
    </div>
</template>

<script>
import AppContent from '@/views/AppContent';

export default {
    name: 'app',
    components: {
        AppContent,
    },
};
</script>

<style lang="sass">
/**
  * ページ移動アニメーション
  */
.page-enter-active, .page-leave-active
    transition: opacity .5s

.page-enter, .page-leave-to
    opacity: 0
</style>

<style lang="sass">
html
    overflow: auto !important
    -webkit-overflow-scrolling: touch

    &.freeze
        -webkit-overflow-scrolling: auto

/**
 * dialog の設定
 */
.v-dialog__content.v-dialog__content--active
    .v-dialog.v-dialog--active
        margin-left: 0
        margin-right: 0
        max-height: calc( 100% -  120px)

.menu-button
    > .v-btn__content, > .v-icon
        pointer-events: none
</style>
