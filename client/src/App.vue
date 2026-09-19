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

/**
 * ページ数入力ダイアログをソフトウェアキーボードに隠れないようにする。
 * キーボードの高さは固定値で持たず、visualViewport から受け取った値を --vk-* で受け取る。
 *
 * 1. visualViewport 非対応環境: 画面が狭いときは上寄せにする (フォールバック)
 * 2. visualViewport 対応環境: JS が --vk-offset-top (可視領域の上端)、--vk-keyboard-height
 *    (キーボードに隠れている高さ)、--vk-available-height (可視領域の高さ - 余白) を設定し、
 *    `.page-input-dialog--visual-viewport` を付ける。中央寄せを基準に
 *    「可視領域の中央」へずらす量は offsetTop - keyboardHeight / 2 になる
 * 3. 100dvh も無い環境は 100% を高さの上限にする
 */
@media screen and (max-width: 600px)
    .v-dialog.page-input-dialog
        align-self: flex-start
        margin-top: 12px

// --active を条件にしない: 閉じるアニメーション中に --active が外れても位置が変わらないようにするため
.v-dialog__content .v-dialog.page-input-dialog.page-input-dialog--visual-viewport
    align-self: center
    // 上下の余白を消して、可視領域の中央に正しく置けるようにする
    margin: 0
    position: relative
    // 中央寄せの位置から、キーボードを除いた可視領域の中央へずらす
    top: calc(var(--vk-offset-top, 0px) - var(--vk-keyboard-height, 0px) / 2)
    max-height: var(--vk-available-height, calc(100% - 24px))

@supports (height: 100dvh)
    .v-dialog__content .v-dialog.page-input-dialog
        max-height: calc(100dvh - 24px)

/**
 * ページ数入力ダイアログの開閉アニメーション。
 * Vuetify の既定 (dialog-transition) は scale(0.5) で縮みながら 0.3 秒かかるため、
 * このダイアログだけ scale をやめて 0.15 秒のフェードにする。
 */
.page-input-dialog.v-dialog
    transition-duration: 0.15s

.page-input-dialog.dialog-transition-enter,
.page-input-dialog.dialog-transition-leave-to
    transform: none
    opacity: 0

.menu-button
    > .v-btn__content, > .v-icon
        pointer-events: none
</style>

<style lang="sass">
/**
 * iOS でスクロール時に表示が崩れるため
 * アドレスバーを常時最大サイズで表示させる
 */
html.fix-address-bar
    height: 100%
    overflow: hidden !important

html.fix-address-bar2
    height: 100%
    overflow: auto !important

html.fix-address-bar, html.fix-address-bar2
    body, #app
        height: 100%

    #app
        .v-application--wrap
            height: 100%
            min-height: 100%
</style>

<style lang="sass">
/**
  * メニュー背景
  */
.menu-background
    position: fixed
    top: 0
    left: 0
    width: 100%
    height: 100vh
    z-index: 7 // vuetify アップデート毎に確認が必要
</style>

<style lang="sass">
/**
 * 複数選択時の色
 */
.selected-color
    color: white !important
    background-color: #4285f4 !important
</style>
