import * as m from 'mithril';
import { ViewModelStatus } from '../../../Enums';
import ProgramDetailViewModel from '../../../ViewModel/Program/ProgramDetailViewModel';
import factory from '../../../ViewModel/ViewModelFactory';
import MainLayoutComponent from '../../MainLayoutComponent';
import ParentComponent from '../../ParentComponent';

/**
 * ProgramDetailComponent
 */
class ProgramDetailComponent extends ParentComponent<void> {
    private viewModel: ProgramDetailViewModel;

    constructor() {
        super();
        this.viewModel = <ProgramDetailViewModel> factory.get('ProgramDetailViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus): Promise<void> {
        await this.viewModel.init(status);
    }

    /**
     * page name
     */
    protected getComponentName(): string { return 'ProgramDetail'; }

    /**
     * view
     */
    public view(): m.Child {
        return m(MainLayoutComponent, {
            header: { title: '番組詳細予約' },
            content: [
                this.createContent(),
            ],
            scrollStoped: (scrollTop: number) => {
                this.saveHistoryData(scrollTop);
            },
        });
    }

    /**
     * create content
     * @return m.Child | null
     */
    public createContent(): m.Child {
        const schedule = this.viewModel.getSchedule();
        if (schedule === null) { return null; }

        return m('div', {
            class: 'program-detail-content mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col',
            onupdate: () => { this.restoreMainLayoutPosition(); },
        }, [
            m('div', { class: 'mdl-card__supporting-text' }, [
            ]),
        ]);
    }
}

export default ProgramDetailComponent;

