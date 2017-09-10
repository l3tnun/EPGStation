import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import ProgramInfoViewModel from '../../ViewModel/Program/ProgramInfoViewModel';

/**
* ProgramInfoComponent
*/
class ProgramInfoComponent extends Component<void> {
    private viewModel: ProgramInfoViewModel;

    constructor() {
        super();
        this.viewModel = <ProgramInfoViewModel>(factory.get('ProgramInfoViewModel'));
    }

    /**
    * view
    */
    public view(): m.Child {
        return m('div', { class: 'program-info' }, [
            m('div', { class: 'title' }, this.viewModel.getTitle()),
            this.createChannel(),
            this.createTime(),
            this.crateItem('genre', this.viewModel.getGenres()),
            this.crateItem('description', this.viewModel.getDescription()),
            this.crateItem('extended', this.viewModel.getExtended(), (vnode: m.VnodeDOM<void, this>) => {
                let str = this.viewModel.getExtended();
                str = str.replace(/(http:\/\/[\x21-\x7e]+)/gi, "<a href='$1' target='_blank'>$1</a>");
                str = str.replace(/(https:\/\/[\x21-\x7e]+)/gi, "<a href='$1' target='_blank'>$1</a>");
                (<HTMLElement>vnode.dom).innerHTML = str;
            }),
        ]);
    }

    /**
    * channel 要素を生成
    * @return m.CHild
    */
    private createChannel(): m.Child {
        return m('div', {
            class: 'channel',
            onclick: () => {
                if(m.route.get().split('?')[0] === '/program') { return; }

                m.route.set('/program', this.viewModel.getChannelLinkQuery())
            },
        }, this.viewModel.getChannelName());
    }

    /**
    * time 要素を生成
    * @return m.Child
    */
    private createTime(): m.Child {
        return m('div', {
            class: 'time',
            onclick: () => {
                if(m.route.get().split('?')[0] === '/program') { return; }

                m.route.set('/program', this.viewModel.getProgramsLinkQuery())
            },
        }, this.viewModel.getTime());
    }

    /**
    * item 生成
    * @param className: class name
    * @param text: text
    * @return item
    */
    private crateItem(
        className: string,
        text: string,
        onupdate: ((vnode: m.VnodeDOM<void, this>) => void) | null = null,
    ): m.Child | null {
        if(text === null || text.length === 0) { return null; }

        let attrs: { [key: string]: any } = {
            class: className,
        };

        if(onupdate !== null) {
            attrs.onupdate = (vnode: m.VnodeDOM<void, this>) => { onupdate(vnode); };
        }

        return m('div', attrs, text);
    }
}

export default ProgramInfoComponent;

