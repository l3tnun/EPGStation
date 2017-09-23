import * as m from 'mithril';
import Component from '../Component';
import factory from '../../ViewModel/ViewModelFactory';
import ProgramViewModel from '../../ViewModel/Program/ProgramViewModel';

/**
* BoardBarComponent
*/
class BoardBarComponent extends Component<void> {
    private viewModel: ProgramViewModel;
    private stopTimer: boolean = false;
    private timerId: NodeJS.Timer;

    constructor() {
        super();
        this.viewModel = <ProgramViewModel>(factory.get('ProgramViewModel'));
    }

    public oncreate(): void {
        // 1 分毎に更新
        this.timerId = setTimeout(() => {
            m.redraw();
            if(!this.stopTimer) { this.oncreate(); }
        }, (60 - new Date().getSeconds()) * 1000);
    }

    public onremove(): void {
        // 更新を停止
        this.stopTimer = true;
        clearTimeout(this.timerId);
    }

    /**
    * view
    */
    public view(): m.Children {
        return m('div', { class: 'boardbar', style: this.createStyle() }, 'now');
    }

    /**
    * 長さと位置を計算する
    */
    private createStyle(): string {
        let str = `width: calc(${ this.viewModel.getChannels().length } * var(--channel-width)); left: var(--time-width);`;
        let start = this.viewModel.getTimeParam().start;
        if(start !== 0) {
            let position = Math.floor((new Date().getTime() - start) / 1000 / 60);
            str += `top: calc(${ position } * var(--time-base-height));`
        }

        return str;
    }
}

export default BoardBarComponent;

