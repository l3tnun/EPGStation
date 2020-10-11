<template>
    <div>
        <transition name="snackbar">
            <div v-if="snackbarState.isOpen === true" class="snackbar-wrap">
                <div class="d-flex justify-center" style="position: relative">
                    <div class="d-flex align-center snackbar" v-bind:class="snackbarClass">
                        <div class="text">{{ snackbarState.mainText }}</div>
                        <div class="ma-0 mr-2">
                            <v-btn text small color="white" class="button" v-on:click="onClose">閉じる</v-btn>
                        </div>
                    </div>
                </div>
            </div>
        </transition>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({})
export default class Snackbar extends Vue {
    public snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    get snackbarClass(): any {
        const result: any = {};
        result[this.snackbarState.displayOption.color] = true;

        return result;
    }

    public async onClickButton(): Promise<void> {
        this.snackbarState.isOpen = false;
    }

    public onClose(): void {
        this.snackbarState.close();
    }
}
</script>

<style lang="sass" scoped>
$snackbar-min-width: 300px

.snackbar-wrap
    position: fixed
    width: 100%
    bottom: 0
    z-index: 1000
    pointer-events: none

    .snackbar
        margin: 8px
        padding: 0
        max-width: 680px
        min-height: 48px
        min-width: $snackbar-min-width
        color: white
        box-shadow: 0 3px 5px -1px rgba(0,0,0,.2), 0 6px 10px 0 rgba(0,0,0,.14), 0 1px 18px 0 rgba(0,0,0,.12)
        border-radius: 4px
        pointer-events: auto

    .text
        flex: 1
        min-width: 0
        width: 100%
        padding: 14px 16px
        overflow-wrap: break-word
        white-space: normal

    .button
        flex: 1

@media screen and (max-width: $snackbar-min-width)
    .snackbar
        margin: 8px
        min-width: 100vw !important

/**
  * 表示アニメーション
  */
.snackbar-enter-active, .snackbar-leave-active
    transition: opacity .2s

.snackbar-enter, .snackbar-leave-to
    opacity: 0
</style>
