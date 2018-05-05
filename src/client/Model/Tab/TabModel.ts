import Model from '../Model';

interface TabModelInterface extends Model {
    add(id: string): void;
    get(id: string): number;
    set(id: string, position: number): void;
}

class TabModel extends Model implements TabModelInterface {
    private tabPosition: { [key: string]: number } = {};

    /**
     * 管理する tab を追加
     * @param id: string
     */
    public add(id: string): void {
        if (typeof this.tabPosition[id] === 'undefined') {
            this.tabPosition[id] = 0;
        }
    }

    /**
     * tab の位置を取得
     * @param id: string
     */
    public get(id: string): number {
        return typeof this.tabPosition[id] === 'undefined' ? 0 : this.tabPosition[id];
    }

    /**
     * tab の位置をセット
     * @param id: string
     * @param position: number
     */
    public set(id: string, position: number): void {
        if (typeof this.tabPosition[id] === 'undefined') {
            console.error(id);
            throw new Error(TabModel.IdIsNotFoundError);
        }

        this.tabPosition[id] = position;
    }
}

namespace TabModel {
    export const IdIsNotFoundError = 'IdIsNotFoundError';
}

export { TabModelInterface, TabModel };

