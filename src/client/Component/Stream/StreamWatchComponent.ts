import * as m from 'mithril';
import * as apid from '../../../../api';
import { ViewModelStatus } from '../../Enums';
import DateUtil from '../../Util/DateUtil';
import Util from '../../Util/Util';
import StreamWatchViewModel from '../../ViewModel/Stream/StreamWatchViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import MainLayoutComponent from '../MainLayoutComponent';
import ParentComponent from '../ParentComponent';
import StreamWatchVideoComponent from './StreamWatchVideoComponent';

/**
 * StreamWatchComponent
 */
class StreamWatchComponent extends ParentComponent<void> {
    private viewModel: StreamWatchViewModel;
    private hasInfo: boolean = false;

    constructor() {
        super();

        this.viewModel = <StreamWatchViewModel> factory.get('StreamWatchViewModel');
    }

    protected async parentInitViewModel(status: ViewModelStatus): Promise<void> {
        if (status === 'init') {
            this.hasInfo = false;
        }

        await this.viewModel.init(status);
    }

    /**
     * page name
     */
    protected getComponentName(): string { return 'StreamWatch'; }

    /**
     * view
     */
    public view(): m.Child {
        return m(MainLayoutComponent, {
            header: { title: '視聴' },
            content: [
                m('div', { class: 'stream-video' }, [
                    this.createStopButton(),
                    m(StreamWatchVideoComponent),
                    this.createStreamInfo(),
                ]),
            ],
        });
    }

    /**
     * 配信停止ボタン
     */
    private createStopButton(): m.Child {
        return m('button', {
            class: 'fab-right-bottom mdl-shadow--8dp mdl-button mdl-js-button mdl-button--fab mdl-button--colored',
            onclick: async() => {
                if (typeof m.route.param('stream') === 'undefined') {
                    Util.move('/');

                    return;
                }

                await this.viewModel.stop();
            },
        }, [
            m('i', { class: 'material-icons' }, 'stop'),
        ]);
    }

    /**
     * create stream info
     */
    private createStreamInfo(): m.Child | null {
        const info = this.viewModel.getInfo();
        if (info === null) {
            if (this.hasInfo) {
                // 他の端末でストリームが停止された
                this.hasInfo = false;
                history.back();
            }

            return null;
        }

        this.hasInfo = true;

        return m('div', { class: 'stream-info' }, [
            m('div', { class: 'mdl-card mdl-shadow--2dp mdl-cell mdl-cell--12-col' }, [
                m('div', { class: 'mdl-card__supporting-text' }, [
                    m('div', { class: 'title' }, info.title),
                    m('div', { class: 'time' }, this.createTimeStr(info)),
                    m('div', { class: 'name' }, info.channelName),
                    m('div', { class: 'description' }, info.description),
                ]),
            ]),
        ]);
    }

    /**
     * create time str
     * @param info: apid.StreamInfo
     * @param string
     */
    private createTimeStr(info: apid.StreamInfo): string {
        if (typeof info.startAt === 'undefined' || typeof info.endAt === 'undefined') { return ''; }
        const start = DateUtil.getJaDate(new Date(info.startAt));
        const end = DateUtil.getJaDate(new Date(info.endAt));
        const duration = Math.floor((info.endAt - info.startAt) / 1000 / 60);

        return DateUtil.format(start, 'MM/dd(w) hh:mm:ss') + ' ~ ' + DateUtil.format(end, 'hh:mm:ss') + ` (${ duration }分)`;
    }
}

export default StreamWatchComponent;

