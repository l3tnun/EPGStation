import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import ProgramGenreViewModel from '../../ViewModel/Program/ProgramGenreViewModel';
import GenreUtil from '../../Util/GenreUtil';

/**
* ProgramGenreComponent
*/
class ProgramGenreComponent extends Component<void> {
    private viewModel: ProgramGenreViewModel;

    constructor() {
        super();

        this.viewModel = <ProgramGenreViewModel>(factory.get('ProgramGenreViewModel'));
    }

    /**
    * view
    */
    public view(): m.Child {
        if(this.viewModel.get() === null) {
            if(this.viewModel.isOpen()) {
                this.viewModel.close();
                this.viewModel.openErrorSbackbar();
            }

            return m('div', 'local storage が無効になっています');
        }

        return m('div', [
            m('div', { class: 'program-genre' }, [
                this.createGenreList(),
            ]),
        ]);
    }

    /**
    * create Genre list
    * @return m.Child[]
    */
    private createGenreList(): m.Child[] {
        let result = [];
        for(let i = 0; i <= 0xf; i++) {
            result.push(m('li', { class: 'mdl-list__item' }, [
                m('span', { class: 'mdl-list__item-primary-content' }, GenreUtil.getGenre1(i) ),
                m('span', { class: 'program-genre-dialog-toggle mdl-list__item-secondary-action' }, [
                    m('label', {
                        class: 'mdl-switch mdl-js-switch mdl-js-ripple-effect',
                        onupdate: (vnode: m.VnodeDOM<void, this>) => {
                            if(this.viewModel.tmpGenre === null) { return; }
                            this.toggleLabelOnUpdate(<HTMLInputElement>vnode.dom, this.viewModel.tmpGenre[i]);
                        }
                    }, [
                        m('input', {
                            type: 'checkbox',
                            class: 'mdl-switch__input',
                            checked: this.viewModel.tmpGenre === null ? false : this.viewModel.tmpGenre[i],
                            onclick: m.withAttr('checked', (value) => {
                                if(this.viewModel.tmpGenre === null) { return; }
                                this.viewModel.tmpGenre[i] = value;
                            })
                        })
                    ])
                ])
            ]));
        }

        return result;
    }
}

export default ProgramGenreComponent;

