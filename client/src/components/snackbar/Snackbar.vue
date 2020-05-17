<template>
    <v-snackbar
        v-model="snackbarState.isOpen"
        :color="snackbarState.displayOption.color"
        :right="snackbarState.displayOption.position === 'right'"
        :left="snackbarState.displayOption.position === 'left'"
        :top="snackbarState.displayOption.position === 'top'"
        :bottom="snackbarState.displayOption.position === 'bottom'"
        :timeout="snackbarState.displayOption.timeout"
    >
        {{ snackbarState.mainText }}
        <v-btn text v-on:click="onClickButton">{{ snackbarState.buttonText }}</v-btn>
    </v-snackbar>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Prop, Vue } from 'vue-property-decorator';

@Component({})
export default class Snackbar extends Vue {
    public snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    @Prop()
    public clickButton?: () => void;

    public async onClickButton(): Promise<void> {
        if (typeof this.clickButton === 'undefined') {
            this.snackbarState.isOpen = false;
        } else {
            try {
                await this.clickButton();
            } catch (err) {
                console.error(err);
            }
            this.snackbarState.isOpen = false;
        }
    }
}
</script>
