export type colorType = 'undefined' | 'success' | 'info' | 'error' | string;

export type SnackbarPosition = 'right' | 'left' | 'top' | 'bottom';

export interface SnackbarDipslayOption {
    color: colorType;
    position: SnackbarPosition;
    timeout: number;
}

export interface SnackBarTextOption {
    text: string;
    buttonText?: string;
    position?: SnackbarPosition;
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
