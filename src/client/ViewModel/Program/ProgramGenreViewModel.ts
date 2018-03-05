import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import { SnackbarModelInterface } from '../../Model/Snackbar/SnackbarModel';
import { StorageModelInterface } from '../../Model/Storage/StorageModel';
import ViewModel from '../ViewModel';

/**
 * ProgramGenreViewModel
 */
class ProgramGenreViewModel extends ViewModel {
    private balloon: BalloonModelInterface;
    private snackbar: SnackbarModelInterface;
    private storageModel: StorageModelInterface;

    // localstorage が使用可能かを表す true: 使用可, false: 使用不可
    private useStatus: boolean = true;

    // genre の一時記憶領域
    public tmpGenre: { [key: number]: boolean } | null = null;

    constructor(
        balloon: BalloonModelInterface,
        snackbar: SnackbarModelInterface,
        storageModel: StorageModelInterface,
    ) {
        super();
        this.balloon = balloon;
        this.snackbar = snackbar;
        this.storageModel = storageModel;
    }

    /**
     * init
     */
    public init(): void {
        const storedGenre = this.get();

        // 表示ジャンル情報がなければ作成する
        if (storedGenre === null) {
            const value = {};
            for (let i = 0; i <= 0xf; i++) { value[i] = true; }
            try {
                this.storageModel.set(ProgramGenreViewModel.storageKey, value);
            } catch (err) {
                this.useStatus = false;
                console.error('ProgramGenreViewModel storage write error');
                console.error(err);
                this.snackbar.open('表示ジャンル情報作成に失敗しました');
            }
        }

        this.tmpGenre = this.get();
    }

    /**
     * ジャンル情報の取得
     */
    public get(): { [key: number]: boolean } | null {
        return this.storageModel.get(ProgramGenreViewModel.storageKey);
    }

    /**
     * ジャンル情報の削除
     */
    public remove(): void {
        this.storageModel.remove(ProgramGenreViewModel.storageKey);
    }

    /**
     * ジャンル情報の更新
     */
    public update(): void {
        if (!this.useStatus || this.tmpGenre === null) { return; }
        this.storageModel.set(ProgramGenreViewModel.storageKey, this.tmpGenre);
    }

    /**
     * snackbar で local storage が無効になっていないことを伝える
     */
    public openErrorSbackbar(): void {
        this.snackbar.open('local storage が無効になっています');
    }

    /**
     * 開いているか
     * @return true: open, false: close
     */
    public isOpen(): boolean {
        return this.balloon.isOpen(ProgramGenreViewModel.id);
    }

    /**
     * close balloon
     */
    public close(): void {
        this.balloon.close();
    }
}

namespace ProgramGenreViewModel {
    export const id = 'program-genre';
    export const storageKey = 'genre';
}

export default ProgramGenreViewModel;

