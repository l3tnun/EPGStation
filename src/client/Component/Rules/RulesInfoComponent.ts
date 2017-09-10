import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import RulesInfoViewModel from '../../ViewModel/Rules/RulesInfoViewModel';
import RulesUtil from './RulesUtil';

/**
* RulesInfoComponent
*/
class RulesInfoComponent extends Component<void> {
    private viewModel: RulesInfoViewModel;

    constructor() {
        super();
        this.viewModel = <RulesInfoViewModel>(factory.get('RulesInfoViewModel'));
    }

    /**
    * view
    */
    public view(): m.Child {
        let rule = this.viewModel.get();
        if(rule === null) { return m('div'); }

        return m('div', [
            m('div', { class: 'rules-info' }, [
                this.createItem('keyword', 'キーワード', RulesUtil.createKeywordStr(rule)),
                this.createItem('ignore-keyword', '除外キーワード', RulesUtil.createIgnoreKeywordStr(rule)),
                this.createItem('option', 'オプション', RulesUtil.createOptionStr(rule)),
                this.createItem('broadcast', '放送波', RulesUtil.createBroadcastStr(rule)),
                this.createItem('channel', '放送局', this.viewModel.getChannelName()),
                this.createItem('genre1', 'ジャンル', RulesUtil.createGenre1(rule)),
                this.createItem('genre2', 'サブジャンル', RulesUtil.createGenre2(rule)),
                this.createItem('time', '時刻', RulesUtil.createTimStr(rule)),
                this.createItem('dow', '曜日', RulesUtil.createDowStr(rule)),
            ]),
        ])
    }

    private createItem(className: string, title: string, text: string): m.Child {
        return m('div', { class: className }, [
            title + ': ',
            m('span', text),
        ])
    }
}

export default RulesInfoComponent;

