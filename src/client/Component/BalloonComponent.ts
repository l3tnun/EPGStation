import * as m from 'mithril';
import Util from '../Util/Util';
import BalloonViewModel from '../ViewModel/Balloon/BalloonViewModel';
import factory from '../ViewModel/ViewModelFactory';
import Component from './Component';

enum contentPosition {
    top,
    bottom,
    left,
    right,
}

interface BalloonArgs {
    id: string;
    content: m.Child;
    head?: m.Child;
    action?: m.Child;
    maxWidth: number;
    maxHeight?: number;
    dialogMaxWidth?: number; // dialogMode の最大幅
    dialogMargin?: number; // dialog モード時の上下のマージン
    verticalOnly?: boolean; // 垂直方向を優先する
    horizontalOnly?: boolean; // 水平方向に限定する
    forceDialog?: boolean; // dialog mode を強制する
    forceModal?: boolean; // 範囲外をクリックしても閉じないようにする
    foreBalloon?: boolean; // balloon を強制する
    forceOverflowXAuto?: boolean; // content の overflowX を auto に強制セット
}

/**
 * Balloon
 */
class BalloonComponent extends Component<BalloonArgs> {
    private id: string;
    private hasHead: boolean;
    private hasAction: boolean;
    private maxWidth: number;
    private maxHeight: number | null;
    private dialogMaxWidth: number | null;
    private dialogMargin: number;
    private verticalOnly: boolean;
    private horizontalOnly: boolean;
    private forceDialog: boolean;
    private forceModal: boolean;
    private foreBalloon: boolean;
    private forceOverflowXAuto: boolean;

    private viewModel: BalloonViewModel;
    private isOpen: boolean = false;
    private arrowElement: HTMLElement;

    private position: contentPosition | null = null;
    private opendWindowHeight: number | null = null;

    constructor() {
        super();
        this.viewModel = <BalloonViewModel> factory.get('BalloonViewModel');
    }

    public initViewModel(): void {
        super.initViewModel();
        window.setTimeout(() => { this.viewModel.init(); }, 0);
    }

    public onremove(vnode: m.VnodeDOM<BalloonArgs, this>): void {
        super.onremove(vnode);
        this.enableBackgroundScroll();
    }

    private setOption(vnode: m.Vnode<BalloonArgs, this>): void {
        this.id = vnode.attrs.id;
        this.hasHead = typeof vnode.attrs.head !== 'undefined';
        this.hasAction = typeof vnode.attrs.action !== 'undefined';
        this.maxWidth = vnode.attrs.maxWidth;
        this.maxHeight = typeof vnode.attrs.maxHeight === 'undefined' ? null : vnode.attrs.maxHeight;
        this.dialogMaxWidth = typeof vnode.attrs.dialogMaxWidth === 'undefined' ? null : vnode.attrs.dialogMaxWidth;
        this.dialogMargin = typeof vnode.attrs.dialogMargin === 'undefined' ? BalloonComponent.dialog_margin : vnode.attrs.dialogMargin;
        this.verticalOnly = typeof vnode.attrs.verticalOnly === 'undefined' ? false : vnode.attrs.verticalOnly;
        this.horizontalOnly = typeof vnode.attrs.horizontalOnly === 'undefined' ? false : vnode.attrs.horizontalOnly;
        this.forceDialog = typeof vnode.attrs.forceDialog === 'undefined' ? false : vnode.attrs.forceDialog;
        this.forceModal = typeof vnode.attrs.forceModal === 'undefined' ? false : vnode.attrs.forceModal;
        this.foreBalloon = typeof vnode.attrs.foreBalloon === 'undefined' ? false : vnode.attrs.foreBalloon;
        this.forceOverflowXAuto = typeof vnode.attrs.forceOverflowXAuto === 'undefined' ? false : vnode.attrs.forceOverflowXAuto;
        this.viewModel.add(this.id);
    }

    /**
     * view
     */
    public view(mvnode: m.Vnode<BalloonArgs, this>): m.Children {
        this.setOption(mvnode);

        return m('div', {
            id: this.id,
            class: 'balloonBackground' + (this.isDialogMode() ? ' dialogbackground' : ''),
            onclick: () => {
                if (this.forceModal) { return; }
                this.viewModel.close(this.id);
            },
            onupdate: (v: m.VnodeDOM<BalloonArgs, this>) => {
                this.MainOnUpdate(v);
            },
        }, [
            m('div', {
                class: 'content',
                style: this.createContentStyle(),
                onclick: (event: Event) => { event.stopPropagation(); },
                onupdate: (vnode: m.VnodeDOM<BalloonArgs, this>) => {
                    const content = <HTMLElement> vnode.dom;
                    content.style.top = '';
                    content.style.left = '';

                    if (this.isOpen) {
                        content.style.maxWidth = `${ this.maxWidth }px`;
                        content.style.maxHeight = this.maxHeight === null ? '' : `${ this.maxHeight }px`;
                        content.style.width = '';

                        // iOS で selector 変更時に window.innerHeight が縮まることに対処
                        if (this.opendWindowHeight === null) {
                            this.opendWindowHeight = window.innerHeight;
                        }

                        if (this.isDialogMode()) {
                            this.resetArrow();
                        } else {
                            if (this.position === null) {
                                // 描画位置判定は一度だけ行う
                                // content が書き換えられるのを待つため window.setTimeout を挟む
                                window.setTimeout(() => { this.position = this.getPosition(vnode, this.opendWindowHeight!); }, 0);
                            }
                            switch (this.position) {
                                case contentPosition.top:
                                    this.setContentTop(vnode);
                                    break;
                                case contentPosition.bottom:
                                    this.setContentBottom(vnode, this.opendWindowHeight);
                                    break;
                                case contentPosition.left:
                                    this.setContentLeft(vnode, this.opendWindowHeight);
                                    break;
                                case contentPosition.right:
                                    this.setContentRight(vnode, this.opendWindowHeight);
                                    break;
                            }
                        }

                        // content が書き換えられるのを待つため window.setTimeout を挟む
                        window.setTimeout(() => { this.setContentHeight(vnode, this.opendWindowHeight); }, 10);
                    } else {
                        this.position = null;
                        this.opendWindowHeight = null;
                        // content の style をリセットするため isOpen === false でも動かす
                        this.setContentHeight(vnode, this.opendWindowHeight);
                    }
                },
            }, [
                mvnode.attrs.head,
                mvnode.attrs.content,
                mvnode.attrs.action,
            ]),
            m('div', {
                class: 'arrow',
                oncreate: (vnode: m.VnodeDOM<BalloonArgs, this>) => {
                    this.arrowElement = <HTMLElement> vnode.dom;
                },
            }),
        ]);
    }

    /**
     * dialogMode かチェック
     * @return true: dialog mode, false: not dialog mode
     */
    private isDialogMode(): boolean {
        return (
            (this.forceDialog
            || this.maxWidth + (BalloonComponent.offset * 2) >= window.innerWidth
            || this.dialogMaxWidth !== null && this.dialogMaxWidth >= window.innerWidth)
            && !this.foreBalloon
        );
    }

    /**
     * balloon 背後のスクロールを無効化
     */
    private disableBackgroundScroll(): void {
        if (!Util.uaIsiOS()) { return; }

        window.setTimeout(() => {
            (<HTMLElement> document.body.parentNode!).classList.add('balloon');
            document.body.classList.add('balloon');
            const elements = document.getElementsByClassName('non-scroll');
            for (let i = 0; i < elements.length; i++) {
                (<HTMLElement> elements[i]).classList.add('non-scroll-enable');
            }
        }, 200);
    }

    /**
     * balloon 背後のスクロールを有効化
     */
    private enableBackgroundScroll(): void {
        if (!Util.uaIsiOS()) { return; }

        (<HTMLElement> document.body.parentNode!).classList.remove('balloon');
        document.body.classList.remove('balloon');
        const elements = document.getElementsByClassName('non-scroll');
        for (let i = 0; i < elements.length; i++) {
            (<HTMLElement> elements[i]).classList.remove('non-scroll-enable');
        }
    }

    /**
     * 背景要素のアニメーションを設定する
     * @param vnode: vnode
     */
    private MainOnUpdate(vnode: m.VnodeDOM<BalloonArgs, this>): void {
        if (this.viewModel.isOpen(this.id) && !this.isOpen) {
            // 表示処理
            this.isOpen = true;
            // 背景のスクロールをさせない
            this.disableBackgroundScroll();

            (<HTMLElement> vnode.dom).style.display = 'block';
            window.setTimeout(() => {
                // スクロール位置をリセット
                (<HTMLElement> vnode.dom.children[0].children[0]).scrollTop = 0;
                (<HTMLElement> vnode.dom.children[0].children[0]).scrollLeft = 0;
                for (let i = 0; i < vnode.dom.children[0].children.length; i++) {
                    (<HTMLElement> vnode.dom.children[0].children[i]).scrollTop = 0;
                    (<HTMLElement> vnode.dom.children[0].children[i]).scrollLeft = 0;
                }

                // アニメーションと共に表示
                (<HTMLElement> vnode.dom).style.opacity = '1';
                m.redraw();
            }, 200);
        } else if (!this.viewModel.isOpen(this.id) && this.isOpen) {
            // アニメーションと共に非表示
            (<HTMLElement> vnode.dom).style.opacity = '0';
            window.setTimeout(() => {
                // 完全に非表示
                (<HTMLElement> vnode.dom).style.display = '';
                this.isOpen = false;

                // 背景のスクロールをさせる
                this.enableBackgroundScroll();
                m.redraw();
            }, 200);
        }
    }

    /**
     * content の style を生成する
     * @return style
     */
    private createContentStyle(): string {
        let str = `max-width: ${ this.maxWidth }px;`;
        if (this.maxHeight !== null) {
            str += ` max-height: ${ this.maxHeight }px;`;
        }

        return str;
    }

    /**
     * content を上下左右のどこに描画するか決める
     * @param vnode: m.VnodeDOM<BalloonArgs, this>
     */
    private getPosition(vnode: m.VnodeDOM<BalloonArgs, this>, windowHeight: number): contentPosition {
        const content = <HTMLElement> vnode.dom;
        const position = Util.getClickPosition(this.viewModel.getEvent());
        const contentWidth = content.offsetWidth;
        const contentHeight = content.offsetHeight;

        let x = 0;
        let y = 0;

        // top
        x = window.innerWidth - (BalloonComponent.offset * 2) < contentWidth ? window.innerWidth - (BalloonComponent.offset * 2) : contentWidth;
        y = position.y - (contentHeight + BalloonComponent.offset) < 0 ? position.y - BalloonComponent.offset : contentHeight;
        let topArea = x * y;
        if (topArea < 0) { topArea = 0; }

        // bottom
        y = position.y + position.height + contentHeight + BalloonComponent.offset > windowHeight ? windowHeight - (position.y + position.height + BalloonComponent.offset) : contentHeight;
        let bottomArea = x * y;
        if (bottomArea < 0) { bottomArea = 0; }

        // left
        x = position.x - (contentWidth + BalloonComponent.offset) < 0 ? position.x - BalloonComponent.offset : contentWidth;
        y = windowHeight - (BalloonComponent.offset * 2) < contentHeight ? windowHeight - (BalloonComponent.offset * 2) : contentHeight;
        let leftArea = x * y;
        if (leftArea < 0) { leftArea = 0; }

        // right
        x = position.x + position.width + contentWidth + BalloonComponent.offset > window.innerWidth ? contentWidth - ((position.x + position.width + contentWidth + BalloonComponent.offset) - window.innerWidth) : contentWidth;
        let rightArea = x * y;
        if (rightArea < 0) { rightArea = 0; }

        if (this.horizontalOnly || !this.verticalOnly && window.innerWidth - position.x < 25) {
            // 左右 only
            topArea = bottomArea = 0;
        } else if (this.verticalOnly) {
            // 上下 only
            leftArea = rightArea = 0;
        }

        if (topArea > bottomArea && topArea >= leftArea && topArea >= rightArea) {
            return contentPosition.top;
        } else if (bottomArea >= topArea && bottomArea >= leftArea && bottomArea >= rightArea) {
            return contentPosition.bottom;
        } else if (leftArea > topArea && leftArea > bottomArea && leftArea >= rightArea) {
            return contentPosition.left;
        } else {
            return contentPosition.right;
        }
    }

    /**
     * 上に描画する
     * @param vnode: m.VnodeDOM<BalloonArgs, this>
     */
    private setContentTop(vnode: m.VnodeDOM<BalloonArgs, this>): void {
        const position = Util.getClickPosition(this.viewModel.getEvent());
        const content = <HTMLElement> vnode.dom;
        const contentWidth = content.offsetWidth;
        const contentHeight = content.offsetHeight;

        let top = position.y - (contentHeight + BalloonComponent.offset);
        let left = position.x + (position.width / 2) - (contentWidth / 2);

        if (top < BalloonComponent.offset) {
            // 上がはみ出ているので content の高さを縮める
            content.style.maxHeight = (contentHeight + top - BalloonComponent.offset) + 'px';
            top = BalloonComponent.offset;
        }

        // 左右のはみ出し
        if (left < BalloonComponent.offset) { left = BalloonComponent.offset; }
        else if (left + contentWidth > window.innerWidth - BalloonComponent.offset) {
            left -= (left + contentWidth) - (window.innerWidth - BalloonComponent.offset);
            if (left < 0) {
                content.style.maxWidth = contentWidth + left - BalloonComponent.offset + 'px';
                left = BalloonComponent.offset;
            }
        }

        content.style.top = top + 'px';
        content.style.left = left + 'px';

        // 矢印
        const clickWidth = position.x + position.width > window.innerWidth ? window.innerWidth - position.x : position.width;
        let x = position.x + clickWidth / 2 - BalloonComponent.offset;
        if (left + contentWidth - BalloonComponent.offset * 2 < x) {
            x = left + contentWidth - BalloonComponent.offset * 2;
        } else if (x < BalloonComponent.offset) {
            x = BalloonComponent.offset;
        }

        this.setArrow('bottom', x, position.y - BalloonComponent.offset);
    }

    /**
     * 下に描画する
     * @param vnode: m.VnodeDOM<BalloonArgs, this>
     */
    private setContentBottom(vnode: m.VnodeDOM<BalloonArgs, this>, windowHeight: number): void {
        const position = Util.getClickPosition(this.viewModel.getEvent());
        const content = <HTMLElement> vnode.dom;
        const contentWidth = content.offsetWidth;
        const contentHeight = content.offsetHeight;

        const top = position.y + position.height + BalloonComponent.offset;
        let left = position.x + (position.width / 2) - (contentWidth / 2);

        if (top + contentHeight > windowHeight - BalloonComponent.offset) {
            // 下がはみ出ているので content の高さを縮める
            content.style.maxHeight = (contentHeight - ((top + contentHeight) - (windowHeight - BalloonComponent.offset))) + 'px';
        }

        // 左右のはみ出し
        if (left < BalloonComponent.offset) { left = BalloonComponent.offset; }
        else if (left + contentWidth > window.innerWidth - BalloonComponent.offset) {
            left -= (left + contentWidth) - (window.innerWidth - BalloonComponent.offset);
            if (left < 0) {
                content.style.maxWidth = contentWidth + left - BalloonComponent.offset + 'px';
                left = BalloonComponent.offset;
            }
        }


        content.style.top = top + 'px';
        content.style.left = left + 'px';

        // 矢印
        const clickWidth = position.x + position.width > window.innerWidth ? window.innerWidth - position.x : position.width;
        let x = position.x + clickWidth / 2 - BalloonComponent.offset;
        if (left + contentWidth - BalloonComponent.offset * 2 < x) {
            x = left + contentWidth - BalloonComponent.offset * 2;
        } else if (x < BalloonComponent.offset) {
            x = BalloonComponent.offset;
        }

        this.setArrow('top', x, position.y + position.height);
    }

    /**
     * 左に描画する
     * @param vnode: m.VnodeDOM<BalloonArgs, this>
     */
    private setContentLeft(vnode: m.VnodeDOM<BalloonArgs, this>, windowHeight: number): void {
        const position = Util.getClickPosition(this.viewModel.getEvent());
        const content = <HTMLElement> vnode.dom;
        const contentWidth = content.offsetWidth;
        const contentHeight = content.offsetHeight;

        // click した element の高さが画面外まで伸びているときは修正
        if (position.y + position.height > windowHeight - BalloonComponent.offset) {
            position.height -= (position.y + position.height) - (windowHeight - BalloonComponent.offset);
        }

        let top = position.y + (position.height / 2) - (contentHeight / 2);
        let left = position.x - contentWidth - BalloonComponent.offset;

        if (top + contentHeight > windowHeight - BalloonComponent.offset) {
            // 下がはみ出ているので top を上にずらす
            top -= (top + contentHeight) - (windowHeight - BalloonComponent.offset);
        }
        if (top < BalloonComponent.offset) {
            // 上がはみ出ているので下にずらす
            top = BalloonComponent.offset;

            if (top + contentHeight > windowHeight - BalloonComponent.offset) {
                // 下がはみ出ているので縮める
                content.style.maxHeight = (windowHeight - BalloonComponent.offset * 2) + 'px';
            }
        }

        if (left < BalloonComponent.offset) {
            // 左側がはみ出ているので content の幅を縮める
            content.style.width = (contentWidth + left - BalloonComponent.offset) + 'px';
            left = BalloonComponent.offset;
        }

        content.style.top = top + 'px';
        content.style.left = left + 'px';

        // 矢印
        let y = position.y + position.height / 2 - BalloonComponent.offset;
        if (y < BalloonComponent.offset) {
            y = BalloonComponent.offset;
        } else if (y > windowHeight - BalloonComponent.offset) {
            y = windowHeight - BalloonComponent.offset;
        }

        this.setArrow('right', position.x - BalloonComponent.offset, y);
    }

    /**
     * 右に描画する
     * @param vnode: m.VnodeDOM<BalloonArgs, this>
     */
    private setContentRight(vnode: m.VnodeDOM<BalloonArgs, this>, windowHeight: number): void {
        const position = Util.getClickPosition(this.viewModel.getEvent());
        const content = <HTMLElement> vnode.dom;
        const contentWidth = content.offsetWidth;
        const contentHeight = content.offsetHeight;

        // click した element の高さが画面外まで伸びているときは修正
        if (position.y + position.height > windowHeight - BalloonComponent.offset) {
            position.height -= (position.y + position.height) - (windowHeight - BalloonComponent.offset);
        }

        let top = position.y + (position.height / 2) - (contentHeight / 2);
        const left = position.x + position.width + BalloonComponent.offset;

        if (top + contentHeight > windowHeight - BalloonComponent.offset) {
            // 下がはみ出ているので top を上にずらす
            top -= (top + contentHeight) - (windowHeight - BalloonComponent.offset);
        }

        if (top < BalloonComponent.offset) {
            // top がはみ出ているので content の高さを縮める
            top = BalloonComponent.offset;

            if (top + contentHeight > windowHeight - BalloonComponent.offset) {
                // 下がはみ出ているので縮める
                content.style.maxHeight = (windowHeight - BalloonComponent.offset * 2) + 'px';
            }
        }

        if (left + contentWidth > window.innerWidth - BalloonComponent.offset) {
            // 右側がはみ出ているので content の幅を縮める
            content.style.width = (contentWidth - ((left + contentWidth) - (window.innerWidth - BalloonComponent.offset))) + 'px';
        }

        content.style.top = top + 'px';
        content.style.left = left + 'px';

        // 矢印
        let y = position.y + position.height / 2 - BalloonComponent.offset;
        if (y < BalloonComponent.offset) {
            y = BalloonComponent.offset;
        } else if (y > windowHeight - BalloonComponent.offset) {
            y = windowHeight - BalloonComponent.offset;
        }

        this.setArrow('left', position.x + position.width, y);
    }

    /**
     * content の中身の高さ、スクロールを設定
     * @param vnode: m.VnodeDOM<BalloonArgs, this>
     */
    private setContentHeight(vnode: m.VnodeDOM<BalloonArgs, this>, windowHeight: number | null): void {
        const parent = <HTMLElement> vnode.dom;
        let parentHeight = parent.offsetHeight;
        const children = parent.children;
        let head: HTMLElement | null = null;
        let content: HTMLElement | null = null;
        let action: HTMLElement | null = null;

        // head, content, action の設定
        if (this.hasHead) {
            head = <HTMLElement> children[0];
            content = <HTMLElement> children[1];
            if (this.hasAction) {
                action = <HTMLElement> children[2];
            }
        } else {
            content = <HTMLElement> children[0];
            if (this.hasAction) {
                action = <HTMLElement> children[1];
            }
        }

        if (!this.isOpen || windowHeight === null) {
            content.style.maxHeight = '';
            content.style.height = '';
            content.style.overflowX = '';
            content.style.overflowY = '';
            parent.style.height = '';

            return;
        }

        // dialog mode 時に parent の高さを調整する
        if (this.isDialogMode()) {
            if (parentHeight + (this.dialogMargin) > windowHeight) {
                parent.style.height = windowHeight - (this.dialogMargin) + 'px';
                parentHeight = parent.offsetHeight;
            }
        } else {
            parent.style.height = '';
        }

        const headHeight = head === null ? 0 : head.offsetHeight;
        const actionHeight = action === null ? 0 : action.offsetHeight;
        const contentsHeight = headHeight + content.offsetHeight + actionHeight;

        if (contentsHeight > parentHeight) {
            let contentHeight = parentHeight - (actionHeight + headHeight);

            if (contentHeight < 0) {
                contentHeight = 0;
            }
            content.style.maxHeight = contentHeight + 'px';
            content.style.height = contentHeight + 'px';
            content.style.overflowX = 'hidden';
            content.style.overflowY = 'auto';
        }

        if (this.forceOverflowXAuto) {
            content.style.overflowX = 'auto';
        }
    }

    /**
     * 矢印の style を設定
     * @param top, bottom, left, right
     * @param x
     * @param y
     */
    private setArrow(name: string, x: number, y: number): void {
        this.arrowElement.className = 'arrow ' + name;
        this.arrowElement.style.left = `${ x }px`;
        this.arrowElement.style.top = `${ y }px`;
    }

    /**
     * 矢印の style をリセットする
     */
    private resetArrow(): void {
        this.arrowElement.className = 'arrow ';
        this.arrowElement.style.left = '';
        this.arrowElement.style.top = '';
    }
}

namespace BalloonComponent {
    export const offset = 12;
    export const dialog_margin = 100;
    export const balloon_margin = 50;
}

export { BalloonArgs, BalloonComponent };

