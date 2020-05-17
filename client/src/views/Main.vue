<template>
    <v-content>
        <TitleBar title="EPGStation"></TitleBar>
        <transition name="page">
            <div v-if="isShow" class="app-content">
                <div>main</div>
            </div>
        </transition>
        <Snackbar></Snackbar>
    </v-content>
</template>

<script lang="ts">
import Snackbar from '@/components/snackbar/Snackbar.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import { Component, Vue, Watch } from 'vue-property-decorator';
@Component({
    components: {
        TitleBar,
        Snackbar,
    },
})
export default class Main extends Vue {
    public isShow: boolean = false;

    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');

    public beforeDestroy(): void {
        this.isShow = false;
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.$nextTick(() => {
            this.isShow = true;

            this.$nextTick(async () => {
                // スクロール位置復元を許可
                await this.scrollState.emitDoneGetData();

                if (this.scrollState.isNeedRestoreHistory === true) {
                    // TODO restore scroll position
                    this.scrollState.isNeedRestoreHistory = false;
                }
            });
        });
    }
}
</script>
