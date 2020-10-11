import { injectable } from 'inversify';
import ISnackbarState, { SnackbarDipslayOption, SnackBarTextOption } from './ISnackbarState';

@injectable()
class SnackbarState implements ISnackbarState {
    public isOpen: boolean = false;
    public displayOption: SnackbarDipslayOption = {
        color: SnackbarState.NROMAL_COLOR,
        timeout: 2000,
    };
    public mainText: string = '';
    public buttonText: string;

    private timerId: number | null = null;

    constructor() {
        this.buttonText = this.getDefaultButtonText();
    }

    /**
     * ボタンのデフォルトテキストを返す
     * @return string
     */
    private getDefaultButtonText(): string {
        return '閉じる';
    }

    /**
     * open snackbar
     * @param option: SnackBarTextOption
     */
    public open(option: SnackBarTextOption): void {
        this.mainText = option.text;
        this.displayOption.color = typeof option.color === 'undefined' || option.color === 'normal' ? SnackbarState.NROMAL_COLOR : option.color;
        this.displayOption.timeout = typeof option.timeout === 'undefined' ? 1500 : option.timeout;
        this.isOpen = true;

        if (this.timerId !== null) {
            clearTimeout(this.timerId);
        }

        this.timerId = setTimeout(() => {
            this.close();
        }, this.displayOption.timeout);
    }

    /**
     * close snackbar
     */
    public close(): void {
        if (this.timerId === null) {
            return;
        }

        clearTimeout(this.timerId);
        this.timerId = null;
        this.isOpen = false;
    }
}

namespace SnackbarState {
    export const NROMAL_COLOR = 'grey darken-3';
}

export default SnackbarState;
