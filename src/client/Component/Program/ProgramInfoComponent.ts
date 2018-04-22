import * as m from 'mithril';
import Util from '../../Util/Util';
import ProgramInfoViewModel from '../../ViewModel/Program/ProgramInfoViewModel';
import factory from '../../ViewModel/ViewModelFactory';
import Component from '../Component';

/**
 * ProgramInfoComponent
 */
class ProgramInfoComponent extends Component<void> {
    private viewModel: ProgramInfoViewModel;

    constructor() {
        super();
        this.viewModel = <ProgramInfoViewModel> factory.get('ProgramInfoViewModel');
    }

    /**
     * view
     */
    public view(): m.Child {
        return m('div', { class: 'program-info' }, [
            m('div', {
                class: 'content-parent',
                style: this.viewModel.hasReserveOption() ? 'padding-bottom: 0;' : '',
            }, [
                m('div', { class: 'title' }, this.viewModel.getTitle()),
                this.createChannel(),
                this.createTime(),
                this.createItem('genre', this.viewModel.getGenres()),
                this.createItem('description', this.viewModel.getDescription()),
                this.createItem('extended', this.viewModel.getExtended(), (vnode: m.VnodeDOM<void, this>) => {
                    let str = this.viewModel.getExtended();
                    str = str.replace(/(http:\/\/[\x21-\x7e]+)/gi, "<a href='$1' target='_blank'>$1</a>");
                    str = str.replace(/(https:\/\/[\x21-\x7e]+)/gi, "<a href='$1' target='_blank'>$1</a>");
                    (<HTMLElement> vnode.dom).innerHTML = str;
                }),
                this.createItem('video', '映像: ' + this.viewModel.getVideoInfo()),
                this.createItem('audio-mode', '音声: ' + this.viewModel.getAudioMode()),
                this.createItem('audio-sampling-rate', 'サンプリングレート: ' + this.viewModel.getAudioSamplingRate()),
                this.createItem('is-free', this.viewModel.getIsFree()),
            ]),
            this.createReserveOption(),
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
                if (m.route.get().split('?')[0] === '/program') { return; }

                Util.move('/program', this.viewModel.getChannelLinkQuery());
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
                if (m.route.get().split('?')[0] === '/program') { return; }

                Util.move('/program', this.viewModel.getProgramsLinkQuery());
            },
        }, this.viewModel.getTime());
    }

    /**
     * create reserve option
     * @return m.Child[] | null
     */
    public createReserveOption(): m.Child[] | null {
        const option = this.viewModel.getReservesOption();
        if (option === null) { return null; }

        const content: m.Child[] = [];

        if (typeof option.option !== 'undefined') {
            content.push(m('hr'));
            content.push(m('div', { class: 'option-parent' }, [
                this.createItem('title', 'オプション'),
                this.createItem(
                    'reserve-type',
                    '予約種類: ' + (this.viewModel.getReserveOptionRuleId() === null ? '手動' : 'ルール'),
                ),
                this.createItem(
                    'option-directory',
                    'ディレクトリ: ' + (option.option.directory || 'ルート'),
                ),
                this.createItem(
                    'option-recordedFormat',
                    'ファイル名形式: ' + (option.option.recordedFormat || 'デフォルト'),
                ),
            ]));
        }

        if (typeof option.encode !== 'undefined') {
            content.push(m('hr'));

            const encodeContent: m.Child[] = [this.createItem('title', 'エンコード')];
            const names = this.viewModel.getEncodeOptionNames();
            // mode1
            if (typeof option.encode.mode1 !== 'undefined') {
                encodeContent.push(this.createItem(
                    'encode-mode',
                    `mode1: ${ names[option.encode.mode1] || option.encode.mode1 }`,
                ));

                if (typeof option.encode.directory1 !== 'undefined') {
                    encodeContent.push(this.createItem('encode-directory', `dir1: ${ option.encode.directory1 }`));
                }
            }

            // mode2
            if (typeof option.encode.mode2 !== 'undefined') {
                encodeContent.push(this.createItem(
                    'encode-mode',
                    `mode2: ${ names[option.encode.mode2] || option.encode.mode2 }`,
                ));

                if (typeof option.encode.directory2 !== 'undefined') {
                    encodeContent.push(this.createItem('encode-directory', `dir2: ${ option.encode.directory2 }`));
                }
            }

            // mode3
            if (typeof option.encode.mode3 !== 'undefined') {
                encodeContent.push(this.createItem(
                    'encode-mode',
                    `mode3: ${ names[option.encode.mode3] || option.encode.mode3 }`,
                ));

                if (typeof option.encode.directory3 !== 'undefined') {
                    encodeContent.push(this.createItem('encode-directory', `dir3: ${ option.encode.directory3 }`));
                }
            }

            encodeContent.push(this.createItem(
                'del-ts',
                'TS 削除: ' + (option.encode.delTs ? '有効' : '無効'),
            ));

            content.push(m('div', { class: 'encode-parent' }, encodeContent));
        }

        return content;
    }

    /**
     * item 生成
     * @param className: class name
     * @param text: text
     * @return item
     */
    private createItem(
        className: string,
        text: string,
        onupdate: ((vnode: m.VnodeDOM<void, this>) => void) | null = null,
    ): m.Child | null {
        if (text === null || text.length === 0) { return null; }

        const attrs: { [key: string]: any } = {
            class: className,
        };

        if (onupdate !== null) {
            attrs.onupdate = (vnode: m.VnodeDOM<void, this>) => { onupdate(vnode); };
        }

        return m('div', attrs, text);
    }
}

export default ProgramInfoComponent;

