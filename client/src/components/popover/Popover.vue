<template>
    <div v-if="isShow === true" class="popover-wrap" ref="popoverWrap" v-bind:class="popoverWrapClass" v-on:click="onClose">
        <div class="popover" ref="popover" v-bind:style="popoverStyle">
            <div class="title-wrap">
                <slot name="title"></slot>
            </div>
            <div class="content-wrap" ref="contentWrap">
                <slot name="content" ref="content"></slot>
            </div>
            <div class="action-wrap">
                <slot name="action" ref="action"></slot>
            </div>
        </div>
        <div class="arrow" v-bind:class="arrowClass" v-bind:style="arrowStyle"></div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import UaUtil from '@/util/UaUtil';
import Util from '@/util/Util';
import { cloneDeep, debounce } from 'lodash';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';

type DisplayPosition = 'top' | 'bottom' | 'left' | 'right';

interface ElementPosition {
    x: number;
    y: number;
    height: number;
    width: number;
}

@Component({})
class Popover extends Vue {
    @Prop({ required: true })
    public isOpen!: boolean;

    @Prop({ required: true })
    public event!: Event | null;

    @Prop({ required: true })
    public maxWidth!: number;

    @Prop({ required: true })
    public maxHeight!: number;

    @Prop({ required: false })
    public isVertical?: boolean; // 垂直方向のみ展開する

    @Prop({ required: false })
    public isHorizontal?: boolean; // 水平方向のみ展開する

    public isShow: boolean = false; // アニメーションを表示させるため isOpen から遅延させて動かす
    public popoverWrapClass: any = {
        'is-dark': this.$vuetify.theme.dark,
        'is-showing': false,
    };
    public popoverStyle: any = {};
    public arrowClass: any = {};
    public arrowStyle: any = {};

    private windowResizeCallback = debounce(() => {
        this.close();
    }, 100);

    public created(): void {
        // リサイズイベント追加
        window.addEventListener('resize', this.windowResizeCallback, false);
    }

    public beforeDestroy(): void {
        // リサイズイベント追加
        window.removeEventListener('resize', this.windowResizeCallback, false);
    }

    @Watch('isOpen', { immediate: false, deep: false })
    public onStateChange(value: boolean): void {
        if (this.isOpen === false) {
            this.close();

            return;
        }

        // init popover wrap class
        // 要素追加
        this.isShow = true;

        // init popoverStyle
        this.popoverStyle.maxWidth = this.maxWidth.toString(10) + 'px';
        this.popoverStyle.maxHeight = this.maxHeight.toString(10) + 'px';
        this.popoverStyle.height = 'auto';

        this.$nextTick(() => {
            if (this.event === null || typeof this.$refs.popover === 'undefined') {
                return;
            }

            const position = this.getPosition(this.$refs.popover as HTMLElement, this.event);
            this.setContent(position, this.event);

            this.$nextTick((): void => {
                // 要素のリサイズによる表示ずれを修正
                if (this.event !== null) {
                    this.setContent(position, this.event);
                }

                // 要素を表示 (アニメーション付き)
                this.$set(this.popoverWrapClass, 'is-showing', true);

                if (UaUtil.isiOS() === true) {
                    const html = document.getElementsByTagName('HTML')[0];
                    html.classList.add('freeze');
                }
            });
        });
    }

    /**
     * popover-wrap クリック時
     */
    public onClose(event: Event): void {
        if (event.target === this.$refs.popoverWrap) {
            this.close();
        }
    }

    /**
     * close popover
     */
    private async close(): Promise<void> {
        this.$emit('update:isOpen', false);

        if (UaUtil.isiOS() === true) {
            const html = document.getElementsByTagName('HTML')[0];
            html.classList.remove('freeze');
        }

        // 非表示にする (アニメーション付き)
        this.$set(this.popoverWrapClass, 'is-showing', false);

        await Util.sleep(300);

        // 要素を削除する
        this.isShow = false;
        this.popoverStyle = {};
        this.arrowClass = {};
        this.arrowStyle = {};
    }

    /**
     * popover の描画方向を返す
     * @param content: HTMLElement 表示要素
     * @param event: Event クリックイベント
     * @return DisplayPosition
     */
    private getPosition(content: HTMLElement, event: Event): DisplayPosition {
        const position = this.getElementPosition(event);
        const contentWidth = content.offsetWidth;
        const contentHeight = content.offsetHeight;

        let x = 0;
        let y = 0;

        // top
        x = window.innerWidth - Popover.offset * 2 < contentWidth ? window.innerWidth - Popover.offset * 2 : contentWidth;
        y = position.y - (contentHeight + Popover.offset) < 0 ? position.y - Popover.offset : contentHeight;
        let topArea = x * y;
        if (topArea < 0) {
            topArea = 0;
        }

        // bottom
        y =
            position.y + position.height + contentHeight + Popover.offset > window.innerHeight
                ? window.innerHeight - (position.y + position.height + Popover.offset)
                : contentHeight;
        let bottomArea = x * y;
        if (bottomArea < 0) {
            bottomArea = 0;
        }

        // left
        x = position.x - (contentWidth + Popover.offset) < 0 ? position.x - Popover.offset : contentWidth;
        y = window.innerHeight - Popover.offset * 2 < contentHeight ? window.innerHeight - Popover.offset * 2 : contentHeight;
        let leftArea = x * y;
        if (leftArea < 0) {
            leftArea = 0;
        }

        // right
        x =
            position.x + position.width + contentWidth + Popover.offset > window.innerWidth
                ? contentWidth - (position.x + position.width + contentWidth + Popover.offset - window.innerWidth)
                : contentWidth;
        let rightArea = x * y;
        if (rightArea < 0) {
            rightArea = 0;
        }

        if (!!this.isHorizontal === true || (!!this.isVertical === false && window.innerWidth - position.x < 25)) {
            // 左右 only
            topArea = bottomArea = 0;
        } else if (this.isVertical === true) {
            // 上下 only
            leftArea = rightArea = 0;
        }

        if (topArea > bottomArea && topArea >= leftArea && topArea >= rightArea) {
            return 'top';
        } else if (bottomArea >= topArea && bottomArea >= leftArea && bottomArea >= rightArea) {
            return 'bottom';
        } else if (leftArea > topArea && leftArea > bottomArea && leftArea >= rightArea) {
            return 'left';
        } else {
            return 'right';
        }
    }

    /**
     * click event の要素の座標を返す
     * @param event: Event
     * @return ElementPosition
     */
    private getElementPosition(event: Event): ElementPosition {
        let elmX = 0;
        let elmY = 0;

        if ((event as TouchEvent).targetTouches) {
            // is mobile
            elmX = (event as TouchEvent).targetTouches[0].pageX - (event.target as HTMLElement).offsetLeft;
            elmY = (event as TouchEvent).targetTouches[0].pageY - (event.target as HTMLElement).offsetTop;
        } else if ((document.all || 'all' in document) && !UaUtil.isFirefox()) {
            elmX = (event as MouseEvent).offsetX;
            elmY = (event as MouseEvent).offsetY;
        } else {
            elmX = (event as any).layerX;
            elmY = (event as any).layerY;
        }

        const rect = (event.target as HTMLElement).getBoundingClientRect();
        let x = (event as MouseEvent).x - elmX;
        if (x === 0) {
            // firefox で起こる
            x = rect.left;
        }

        let y = (event as MouseEvent).y - elmY;
        if (y === 0) {
            // firefox で起こる
            y = rect.top;
        }

        return {
            x: x,
            y: y,
            width: (event.target as HTMLElement).offsetWidth,
            height: (event.target as HTMLElement).offsetHeight,
        };
    }

    /**
     * popover の表示位置をセットする
     * @param position: DisplayPosition
     * @param event: Event
     */
    private setContent(position: DisplayPosition, event: Event): void {
        switch (position) {
            case 'top':
                this.setContentTop(event, this.$refs.popover as HTMLElement);
                break;
            case 'bottom':
                this.setContentBottom(event, this.$refs.popover as HTMLElement);
                break;
            case 'left':
                this.setContentLeft(event, this.$refs.popover as HTMLElement);
                break;
            case 'right':
                this.setContentRight(event, this.$refs.popover as HTMLElement);
                break;
        }

        this.popoverStyle = cloneDeep(this.popoverStyle);
    }

    /**
     * popover を上向きに描画する
     * @param vent: Event
     * @param content: HTMLElement
     */
    private setContentTop(event: Event, content: HTMLElement): void {
        const position = this.getElementPosition(event);
        const contentWidth = content.offsetWidth;
        const contentHeight = content.offsetHeight;

        let top = position.y - (contentHeight + Popover.offset);
        let left = position.x + position.width / 2 - contentWidth / 2;

        if (top < Popover.offset) {
            // 上がはみ出ているので content の高さを縮める
            this.popoverStyle.maxHeight = contentHeight + top - Popover.offset + 'px';
            this.popoverStyle.height = this.popoverStyle.maxHeight;
            top = Popover.offset;
        }

        // 左右のはみ出し
        if (left < Popover.offset) {
            left = Popover.offset;
        } else if (left + contentWidth > window.innerWidth - Popover.offset) {
            left -= left + contentWidth - (window.innerWidth - Popover.offset);
            if (left < 0) {
                this.popoverStyle.maxWidth = contentWidth + left - Popover.offset + 'px';
                left = Popover.offset;
            }
        }

        this.popoverStyle.top = top + 'px';
        this.popoverStyle.left = left + 'px';

        // 矢印
        const clickWidth = position.x + position.width > window.innerWidth ? window.innerWidth - position.x : position.width;
        let x = position.x + clickWidth / 2 - Popover.offset;
        if (left + contentWidth - Popover.offset * 2 < x) {
            x = left + contentWidth - Popover.offset * 2;
        } else if (x < Popover.offset) {
            x = Popover.offset;
        }
        this.setArrow('bottom', x, position.y - Popover.offset);
    }

    /**
     * popover を下向きに描画する
     * @param vent: Event
     * @param content: HTMLElement
     */
    private setContentBottom(event: Event, content: HTMLElement): void {
        const position = this.getElementPosition(event);
        const contentWidth = content.offsetWidth;
        const contentHeight = content.offsetHeight;

        const top = position.y + position.height + Popover.offset;
        let left = position.x + position.width / 2 - contentWidth / 2;

        if (top + contentHeight > window.innerHeight - Popover.offset) {
            // 下がはみ出ているので content の高さを縮める
            this.popoverStyle.maxHeight = contentHeight - (top + contentHeight - (window.innerHeight - Popover.offset)) + 'px';
            this.popoverStyle.height = this.popoverStyle.maxHeight;
        }

        // 左右のはみ出し
        if (left < Popover.offset) {
            left = Popover.offset;
        } else if (left + contentWidth > window.innerWidth - Popover.offset) {
            left -= left + contentWidth - (window.innerWidth - Popover.offset);
            if (left < 0) {
                this.popoverStyle.maxWidth = contentWidth + left - Popover.offset + 'px';
                left = Popover.offset;
            }
        }

        this.popoverStyle.top = top + 'px';
        this.popoverStyle.left = left + 'px';

        // 矢印
        const clickWidth = position.x + position.width > window.innerWidth ? window.innerWidth - position.x : position.width;
        let x = position.x + clickWidth / 2 - Popover.offset;
        if (left + contentWidth - Popover.offset * 2 < x) {
            x = left + contentWidth - Popover.offset * 2;
        } else if (x < Popover.offset) {
            x = Popover.offset;
        }
        this.setArrow('top', x, position.y + position.height);
    }

    /**
     * popover を左向きに描画する
     * @param vent: Event
     * @param content: HTMLElement
     */
    private setContentLeft(event: Event, content: HTMLElement): void {
        const position = this.getElementPosition(event);
        const contentWidth = content.offsetWidth;
        const contentHeight = content.offsetHeight;

        // click した element の高さが画面外まで伸びているときは修正
        if (position.y + position.height > window.innerHeight - Popover.offset) {
            position.height -= position.y + position.height - (window.innerHeight - Popover.offset);
        }

        let top = position.y + position.height / 2 - contentHeight / 2;
        let left = position.x - contentWidth - Popover.offset;

        if (top + contentHeight > window.innerHeight - Popover.offset) {
            // 下がはみ出ているので top を上にずらす
            top -= top + contentHeight - (window.innerHeight - Popover.offset);
        }
        if (top < Popover.offset) {
            // 上がはみ出ているので下にずらす
            top = Popover.offset;

            if (top + contentHeight > window.innerHeight - Popover.offset) {
                // 下がはみ出ているので縮める
                this.popoverStyle.maxHeight = window.innerHeight - Popover.offset * 2 + 'px';
                this.popoverStyle.height = this.popoverStyle.maxHeight;
            }
        }

        if (left < Popover.offset) {
            // 左側がはみ出ているので content の幅を縮める
            this.popoverStyle.width = contentWidth + left - Popover.offset + 'px';
            left = Popover.offset;
        }

        this.popoverStyle.top = top + 'px';
        this.popoverStyle.left = left + 'px';

        // 矢印
        let y = position.y + position.height / 2 - Popover.offset;
        if (y < Popover.offset) {
            y = Popover.offset;
        } else if (y > window.innerHeight - Popover.offset) {
            y = window.innerHeight - Popover.offset;
        }
        this.setArrow('right', position.x - Popover.offset - 1, y);
    }

    /**
     * popover を右向きに描画する
     * @param vent: Event
     * @param content: HTMLElement
     */
    private setContentRight(event: Event, content: HTMLElement): void {
        const position = this.getElementPosition(event);
        const contentWidth = content.offsetWidth;
        const contentHeight = content.offsetHeight;

        // click した element の高さが画面外まで伸びているときは修正
        if (position.y + position.height > window.innerHeight - Popover.offset) {
            position.height -= position.y + position.height - (window.innerHeight - Popover.offset);
        }

        let top = position.y + position.height / 2 - contentHeight / 2;
        const left = position.x + position.width + Popover.offset;

        if (top + contentHeight > window.innerHeight - Popover.offset) {
            // 下がはみ出ているので top を上にずらす
            top -= top + contentHeight - (window.innerHeight - Popover.offset);
        }

        if (top < Popover.offset) {
            // top がはみ出ているので content の高さを縮める
            top = Popover.offset;

            if (top + contentHeight > window.innerHeight - Popover.offset) {
                // 下がはみ出ているので縮める
                this.popoverStyle.maxHeight = window.innerHeight - Popover.offset * 2 + 'px';
                this.popoverStyle.height = this.popoverStyle.maxHeight;
            }
        }

        if (left + contentWidth > window.innerHeight - Popover.offset) {
            // 右側がはみ出ているので content の幅を縮める
            this.popoverStyle.width = contentWidth - (left + contentWidth - (window.innerHeight - Popover.offset)) + 'px';
        }

        this.popoverStyle.top = top + 'px';
        this.popoverStyle.left = left + 'px';

        // 矢印
        let y = position.y + position.height / 2 - Popover.offset;
        if (y < Popover.offset) {
            y = Popover.offset;
        } else if (y > window.innerHeight - Popover.offset) {
            y = window.innerHeight - Popover.offset;
        }
        this.setArrow('left', position.x + position.width + 1, y);
    }

    /**
     * 矢印の style を設定
     * @param top, bottom, left, right
     * @param x
     * @param y
     */
    private setArrow(name: string, x: number, y: number): void {
        this.$set(this.arrowClass, name, true);
        this.$set(this.arrowStyle, 'left', `${x}px`);
        this.$set(this.arrowStyle, 'top', `${y}px`);
    }
}

namespace Popover {
    export const offset = 12;
}

export default Popover;
</script>

<style lang="sass" scoped>
.popover-wrap
    position: fixed
    width: 100%
    height: 100%
    top: 0
    left: 0
    z-index: 100
    opacity: 0
    transition: opacity 0.2s
    --background-color: white
    box-sizing: border-box

    &.is-dark
        --background-color: #424242

    &.is-showing
        opacity: 1

    .popover
        display: flex
        flex-direction: column
        background: var(--background-color)
        position: absolute
        border-radius: 2px
        word-wrap: break-word
        box-shadow: 0 9px 46px 8px rgba(0,0,0,.14), 0 11px 15px -7px rgba(0,0,0,.12), 0 24px 38px 3px rgba(0,0,0,.2)

        .content-wrap
            overflow-y: auto

    .arrow
        content: ''
        position: fixed
        box-sizing: border-box
        z-index: 1

        &.bottom
            border-top: 12px solid var(--background-color)
            border-right: 12px solid transparent
            border-left: 12px solid transparent

        &.top
            border-bottom: 12px solid var(--background-color)
            border-right: 12px solid transparent
            border-left: 12px solid transparent

        &.right
            border-left: 12px solid var(--background-color)
            border-top: 12px solid transparent
            border-bottom: 12px solid transparent

        &.left
            border-right: 12px solid var(--background-color)
            border-top: 12px solid transparent
            border-bottom: 12px solid transparent
</style>
