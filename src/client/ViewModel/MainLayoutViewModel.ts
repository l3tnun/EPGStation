import * as m from 'mithril';
import { ViewModelStatus } from '../Enums';
import ViewModel from './ViewModel';

/**
 * MainLayoutViewModel
 */
class MainLayoutViewModel extends ViewModel {
    private hasViewData: boolean = false;

    /**
     * init ParentComponent の init で呼ぶ
     * @param status: status: ViewModelStatus
     */
    public init(status: ViewModelStatus): void {
        if (status === 'init' || status === 'update') {
            this.hasViewData = false;
            if (status === 'update') { m.redraw(); }
        }
    }

    /**
     * ParentComponent の init でデータ取得後に呼ぶ
     */
    public update(): void {
        this.hasViewData = true;
        m.redraw();
    }

    /**
     * MainLayout の表示状態を取得
     * @return boolean; true: 表示, false: 非表示
     */
    public isShow(): boolean {
        return this.hasViewData;
    }
}

export default MainLayoutViewModel;

