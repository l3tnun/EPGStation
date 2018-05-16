import * as m from 'mithril';
import * as apid from '../../../../../api';
import { ViewModelStatus } from '../../../Enums';
import DateUtil from '../../../Util/DateUtil';
import RecordedWatchViewModel from '../../../ViewModel/Recorded/RecordedWatchViewModel';
import factory from '../../../ViewModel/ViewModelFactory';
import MainLayoutComponent from '../../MainLayoutComponent';
import ParentComponent from '../../ParentComponent';

/**
 * RecordedWatchComponent
 */
class RecordedWatchComponent extends ParentComponent<void> {
    private viewModel: RecordedWatchViewModel;

    constructor() {
        super();
        this.viewModel = <RecordedWatchViewModel> factory.get('RecordedWatchViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus): Promise<void> {
        await this.viewModel.init(status);
    }

    /**
     * page name
     */
    protected getComponentName(): string { return 'RecordedWatch'; }

    /**
     * view
     */
    public view(): m.Child {
        return m(MainLayoutComponent, {
            header: {
                title: '録画視聴',
            },
            content: [
                this.createContent(),
            ],
        });
    }

    /**
     * content
     * @return m.Child
     */
    private createContent(): m.Child {
        return m('div', {
            class: 'recorded-watch',
        }, [
            this.createVideo(),
            this.createRecordedInfo(),
        ]);
    }

    /**
     * create video
     * @return m.Child
     */
    private createVideo(): m.Child {
        return m('div', 'video');
    }

    /**
     * create recorded info
     * @return m.Child
     */
    private createRecordedInfo(): m.Child | null {
        const recorded = this.viewModel.getRecorded();
        if (recorded === null) {
            return null;
        }

        return m('div', { class: 'recorded-info', }, [
            m('div', { class: 'mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col' }, [
                m('div', { class: 'mdl-card__supporting-text' }, [
                    m('div', { class: 'title' }, recorded.name),
                    m('div', { class: 'time' }, this.createTimeStr(recorded)),
                    m('div', { class: 'name' }, this.viewModel.getChannelName(recorded.channelId)),
                    m('div', { class: 'description' }, recorded.description),
                ]),
            ]),
        ]);
    }

    /**
     * create recorded time
     * @param recorded: apid.RecordedProgram
     */
    private createTimeStr(recorded: apid.RecordedProgram): m.Child {
        const start = DateUtil.getJaDate(new Date(recorded.startAt));
        const end = DateUtil.getJaDate(new Date(recorded.endAt));
        const duration = Math.floor((recorded.endAt - recorded.startAt) / 1000 / 60);

        return DateUtil.format(start, 'MM/dd(w) hh:mm:ss') + ' ~ ' + DateUtil.format(end, 'hh:mm:ss') + ` (${ duration }分)`;
    }
}

export default RecordedWatchComponent;

