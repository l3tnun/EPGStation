import * as m from 'mithril';
import * as apid from '../../../../api';
import DateUtil from '../../Util/DateUtil';
import Util from '../../Util/Util';
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';
import { ProgramViewModel } from '../../ViewModel/Program/ProgramViewModel';
import StreamSelectViewModel from '../../ViewModel/Stream/StreamSelectViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * ChannelComponent
 */
class ChannelComponent extends Component<void> {
    private viewModel: ProgramViewModel;
    private streamSelector: StreamSelectViewModel;
    private balloon: BalloonViewModel;

    constructor() {
        super();
        this.viewModel = <ProgramViewModel> factory.get('ProgramViewModel');
        this.streamSelector = <StreamSelectViewModel> factory.get('StreamSelectViewModel');
        this.balloon = <BalloonViewModel> factory.get('BalloonViewModel');
    }

    /**
     * view
     */
    public view(): m.Children {
        const childs: m.Children[] = [ m('div', { class: 'item' }, 'dummy') ];
        if (typeof m.route.param('type') !== 'undefined') {
            // 通常の番組表表示
            Array.prototype.push.apply(childs, this.viewModel.getChannels().map((channel, i) => {
                return m('div', {
                    class: 'item',
                    style: `left: calc(${ i } * var(--channel-width) + var(--timescale-width));`,
                    onclick: (e: Event) => {
                        if (this.viewModel.enableLiveStreaming()) {
                            this.streamSelector.set(channel, () => { this.jumpSingleStation(channel); });
                            this.balloon.open(StreamSelectViewModel.id, e);
                        } else {
                            this.jumpSingleStation(channel);
                        }
                    },
                }, channel.name);
            }));
        } else {
            // 単局表示
            const start = this.viewModel.getTimeParam().start;
            Array.prototype.push.apply(childs, this.viewModel.getSchedule().map((_s, i) => {
                const addTime = i * 24 * 60 * 60 * 1000;

                return m('div', {
                    class: 'item',
                    style: `left: calc(${ i } * var(--channel-width) + var(--timescale-width));`,
                }, DateUtil.format(DateUtil.getJaDate(new Date(start + addTime)), 'MM/dd(w)'));
            }));
        }
        // 終端までスクロールした時にずれが発生するためダミー要素を追加する
        childs.push(m('div', { class: 'item', style: `visibility: hidden; left: calc(${ this.viewModel.getSchedule().length } * var(--channel-width))` }));

        return m('div', { class: ProgramViewModel.channlesName }, childs);
    }

    /**
     * 単極表示のページへ飛ぶ
     * channel: channel データ
     */
    private jumpSingleStation(channel: apid.ScheduleServiceItem): void {
        const query: { ch: number; time?: string } = {
            ch: channel.id,
        };

        if (typeof m.route.param('time') !== 'undefined') {
            query.time = m.route.param('time');
        }

        Util.move('/program', query);
    }
}

export default ChannelComponent;

