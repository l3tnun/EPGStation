import * as m from 'mithril';
import Model from '../Model';

interface SnackbarModelInterface extends Model {
    open(message: string): void;
    get(): string | null;
}

/**
* Snackbar Model
*/
class SnackbarModel implements SnackbarModelInterface {
    private tables: string[] = [];

    /**
    * snackbar を開く
    * @param message 表示するメッセージを指定する
    */
    public open(message: string): void {
        this.tables.push(message);
        m.redraw();
    }

    /**
    * 表示する文字列を取得
    * 表示するものがなければ null が返される
    * @return message
    */
    public get(): string | null {
        let result = this.tables.shift();

        return typeof result === 'undefined' ? null : result;
    }
}

export { SnackbarModelInterface, SnackbarModel }

