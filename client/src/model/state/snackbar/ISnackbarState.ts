export type colorType = 'normal' | 'success' | 'info' | 'error';

export interface SnackbarDipslayOption {
    color: string;
    timeout: number;
}

export interface SnackBarTextOption {
    text: string;
    color?: colorType;
    timeout?: number;
}

export default interface ISnackbarState {
    isOpen: boolean;
    displayOption: SnackbarDipslayOption;
    mainText: string;
    buttonText: string;
    open(option: SnackBarTextOption): void;
    close(): void;
}
