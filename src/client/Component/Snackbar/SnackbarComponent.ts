import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import SnackbarViewModel from '../../ViewModel/Snackbar/SnackbarViewModel';

/**
* Material Design Lite の Snackbar を使うための拡張
*/
interface MaterialSnackbar extends HTMLElement {
    MaterialSnackbar: {
        showSnackbar(data : {
            message?: string,
            actionHandler?: (event: any) => any,
            actionText?: string,
            timeout?: number
        }): void;
    }
}

/**
* Snackbar View
*/
class SnackbarComponent extends Component<void> {
    private viewModel: SnackbarViewModel;

    constructor() {
        super();
        this.viewModel = <SnackbarViewModel>(factory.get('SnackbarViewModel'));
    }

    /**
    * view
    */
    public view(): m.Children {
        return m('div', {
                class: 'mdl-js-snackbar mdl-snackbar',
                onupdate: (vnode: m.VnodeDOM<void, this>) => {
                    let message = this.viewModel.get();
                    if(message == null) { return; }
                    (<MaterialSnackbar>(vnode.dom)).MaterialSnackbar.showSnackbar({ message: message });
                }
            }, [
            m('div', { class: 'mdl-snackbar__text' } ),
            m('button', { class: 'mdl-snackbar__action', type: 'button' } )
        ]);
    }
}

export default SnackbarComponent;

