import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import ProgramViewModel from '../../ViewModel/Program/ProgramViewModel';
import DateUtil from '../../Util/DateUtil';
import * as apid from '../../../../api';
import StreamSelectViewModel from '../../ViewModel/Stream/StreamSelectViewModel'
import BalloonViewModel from '../../ViewModel/Balloon/BalloonViewModel';

/**
* ChannelComponent
*/
class ChannelComponent extends Component<void> {
    private viewModel: ProgramViewModel;
    private streamSelector: StreamSelectViewModel;
    private balloon: BalloonViewModel;

    constructor() {
        super();
        this.viewModel = <ProgramViewModel>(factory.get('ProgramViewModel'));
        this.streamSelector = <StreamSelectViewModel>(factory.get('StreamSelectViewModel'));
        this.balloon = <BalloonViewModel>(factory.get('BalloonViewModel'));
    }

    /**
    * view
    */
    public view(): m.Children {
        let childs: m.Children[] = [];
        if(typeof m.route.param('type') !== 'undefined') {
            //通常の番組表表示
            childs = this.viewModel.getChannels().map((channel, i) => {
                return m('div', {
                    class: 'item',
                    style: `left: calc(${ i } * var(--channel-width));`,
                    onclick: (e: Event) => {
                        if(this.streamSelector.getOptions().length > 0) {
                            this.streamSelector.set(channel, () => { this.jumpSingleStation(channel); });
                            this.balloon.open(StreamSelectViewModel.id, e);
                        } else {
                            this.jumpSingleStation(channel);
                        }
                    },
                }, channel.name);
            });
        } else {
            //単局表示
            let start = this.viewModel.getTimeParam().start;
            childs =  this.viewModel.getSchedule().map((_s, i) => {
                let addTime = i * 24 * 60 * 60 * 1000;
                return m('div', {
                    class: 'item',
                    style: `left: calc(${ i } * var(--channel-width));`,
                }, DateUtil.format(DateUtil.getJaDate(new Date(start + addTime)), 'MM/dd(w)'));
            });
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
        let query: { ch: number, time?: string } = {
            ch: channel.id,
        }

        if(typeof m.route.param('time') !== 'undefined') {
            query.time = m.route.param('time');
        }

        m.route.set('/program', query);
    }
}

export default ChannelComponent;

