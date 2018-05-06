import { TabModelInterface } from '../../Model/Tab/TabModel';
import ViewModel from '../ViewModel';

class TabViewModel extends ViewModel {
    private model: TabModelInterface;

    constructor(model: TabModelInterface) {
        super();
        this.model = model;
    }

    /**
     * 管理する tab を追加
     * @param id: string
     */
    public add(id: string): void {
        this.model.add(id);
    }

    /**
     * tab の位置を取得
     * @param id: string
     */
    public get(id: string): number {
        return this.model.get(id);
    }

    /**
     * tab の位置をセット
     * @param id: string
     * @param position: number
     */
    public set(id: string, position: number): void {
        return this.model.set(id, position);
    }
}

export default TabViewModel;

