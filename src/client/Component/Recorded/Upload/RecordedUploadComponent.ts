import * as m from 'mithril';
import { ViewModelStatus } from '../../../Enums';
import RecordedUploadViewModel from '../../../ViewModel/Recorded/RecordedUploadViewModel';
import factory from '../../../ViewModel/ViewModelFactory';
import MainLayoutComponent from '../../MainLayoutComponent';
import ParentComponent from '../../ParentComponent';

/**
 * RecordedUploadComponent
 */
class RecordedUploadComponent extends ParentComponent<void> {
    private viewModel: RecordedUploadViewModel;

    constructor() {
        super();

        this.viewModel = <RecordedUploadViewModel> factory.get('RecordedUploadViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus): Promise<void> {
        this.viewModel.init(status);
    }

    /**
     * page name
     */
    protected getComponentName(): string { return 'RecordedUpload'; }

    /**
     * view
     */
    public view(): m.Child {
        return m(MainLayoutComponent, {
            header: { title: 'アップロード' },
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
     * @return m.Child
     */
    public createContent(): m.Child {
        return m('div', {
            class : 'upload-content mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col',
            onupdate: () => { this.restoreMainLayoutPosition(); },
        }, [
        ]);
    }
}

export default RecordedUploadComponent;

