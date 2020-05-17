import { injectable } from 'inversify';
import ISnackbarState, { SnackbarDipslayOption, SnackBarTextOption } from './ISnackbarState';

@injectable()
export default class SnackbarState implements ISnackbarState {
    public isOpen: boolean = false;
    public displayOption: SnackbarDipslayOption = {
        color: 'undefined',
        position: 'bottom',
        timeout: 2000,
    };
    public mainText: string = '';
    public buttonText: string;

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
        this.buttonText = typeof option.buttonText === 'undefined' ? this.getDefaultButtonText() : option.buttonText;
        this.displayOption.color = typeof option.color === 'undefined' ? 'undefined' : option.color;
        this.displayOption.position = typeof option.position === 'undefined' ? 'bottom' : option.position;
        this.displayOption.timeout = typeof option.timeout === 'undefined' ? 1500 : option.timeout;
        this.isOpen = true;
    }

    /**
     * close snackbar
     */
    public close(): void {
        this.isOpen = false;
    }
}
