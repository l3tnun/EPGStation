<template>
    <div class="extended-pagination">
        <div v-if="maxPage > 1" class="extended-pagination__items v-pagination" v-bind:class="$vuetify.theme.dark === true ? 'theme--dark' : 'theme--light'">
            <button
                type="button"
                class="extended-pagination__button v-pagination__item"
                v-bind:class="{ 'extended-pagination__button--disabled': currentPage <= 1 }"
                v-bind:disabled="currentPage <= 1"
                v-on:click="onMovePage(1)"
                aria-label="最初のページへ移動"
            >
                <v-icon small>mdi-chevron-double-left</v-icon>
            </button>
            <button
                type="button"
                class="extended-pagination__button v-pagination__item"
                v-for="page in pages"
                v-bind:key="page"
                v-bind:class="{ 'extended-pagination__current primary--text': page === currentPage }"
                v-on:click="onClickPage(page)"
                v-bind:aria-label="page === currentPage ? 'ページ数を入力して移動' : `ページ${page}へ移動`"
                v-bind:aria-current="page === currentPage ? 'page' : null"
            >
                {{ page }}
            </button>
            <button
                type="button"
                class="extended-pagination__button v-pagination__item"
                v-bind:class="{ 'extended-pagination__button--disabled': currentPage >= maxPage }"
                v-bind:disabled="currentPage >= maxPage"
                v-on:click="onMovePage(maxPage)"
                aria-label="最後のページへ移動"
            >
                <v-icon small>mdi-chevron-double-right</v-icon>
            </button>
        </div>
        <v-dialog
            v-model="isOpenInputDialog"
            max-width="300"
            scrollable
            v-bind:content-class="isVisualViewportActive === true ? 'page-input-dialog page-input-dialog--visual-viewport' : 'page-input-dialog'"
        >
            <v-card>
                <v-card-title class="subtitle-1">ページ数を入力</v-card-title>
                <v-card-text>
                    <v-text-field
                        ref="inputPage"
                        v-model="inputPage"
                        v-bind:error="isInputError"
                        v-bind:error-messages="inputErrorMessages"
                        label="ページ数"
                        v-bind:placeholder="`1 〜 ${maxPage}`"
                        type="number"
                        min="1"
                        v-bind:max="maxPage"
                        v-on:focus="onInputFocus"
                        v-on:keydown.enter="moveToInputPage"
                    ></v-text-field>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn color="primary" text v-on:click="closeInputDialog">キャンセル</v-btn>
                    <v-btn color="primary" text v-on:click="moveToInputPage">移動</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import Util from '@/util/Util';
import VuetifyUtil from '@/util/VuetifyUtil';
import { cloneDeep } from 'lodash';
import ResizeObserver from 'resize-observer-polyfill';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';

/**
 * window.visualViewport の最小限の型 (未対応環境では undefined になる)
 */
interface VisualViewportLike {
    height: number;
    offsetTop: number;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
}

/**
 * 拡張ページネーション
 * 現在ページを中心にページ番号を並べ、利用可能な横幅に合わせて表示数を 2 要素ずつ増減させる
 */
@Component({})
class ExtendedPagination extends Vue {
    // 1 ページごとの最大表示件数
    @Prop({
        required: true,
    })
    public pageSize!: number;

    // 総件数
    @Prop({
        required: true,
    })
    public total!: number;

    public currentPage: number = 1;
    public isOpenInputDialog: boolean = false;
    public inputPage: string = '';
    public isInputError: boolean = false;
    // visualViewport から受け取った値をダイアログへ適用しているか
    public isVisualViewportActive: boolean = false;

    // レイアウトの実測値 (px)
    private availableWidth: number = 0;
    private itemWidth: number = ExtendedPagination.DEFAULT_ITEM_WIDTH;
    private itemGap: number = ExtendedPagination.DEFAULT_ITEM_GAP;

    private resizeObserver: ResizeObserver | null = null;
    private visualViewport: VisualViewportLike | null = null;
    // 閉じるアニメーション中は位置を動かさない
    private isDialogClosing: boolean = false;
    private visualViewportListener = ((): void => {
        this.updateVisualViewport();
    }).bind(this);

    public mounted(): void {
        this.resizeObserver = new ResizeObserver(() => {
            this.measure();
        });
        if (this.resizeObserver !== null) {
            this.resizeObserver.observe(this.$el);
        }

        // ソフトウェアキーボードの表示・非表示、画面回転に追随する
        this.visualViewport = ExtendedPagination.getVisualViewport();
        if (this.visualViewport !== null) {
            this.visualViewport.addEventListener('resize', this.visualViewportListener);
            this.visualViewport.addEventListener('scroll', this.visualViewportListener);
            // ダイアログを開く前から値を用意しておく (開いた瞬間に位置が変わらないように)
            this.updateVisualViewport();
        }

        this.$nextTick(() => {
            this.measure();
        });
    }

    public beforeDestroy(): void {
        // disconnect resize observer
        if (this.resizeObserver !== null) {
            this.resizeObserver.disconnect();
        }

        if (this.visualViewport !== null) {
            this.visualViewport.removeEventListener('resize', this.visualViewportListener);
            this.visualViewport.removeEventListener('scroll', this.visualViewportListener);
            this.visualViewport = null;
        }
        this.resetVisualViewport();
    }

    /**
     * 最終ページ (既存ページネーションと同じ算出方法)
     */
    get maxPage(): number {
        if (this.total === 0) {
            return 1;
        }

        return Math.ceil(this.total / this.pageSize);
    }

    /**
     * 横幅から決まる要素数の上限 (≪, ≫ を含む)
     * 7 → 9 → 11 → 13 → 15 → 17 の順に、左右へ 1 個ずつ足せる場合だけ増やす
     */
    get elementCountByWidth(): number {
        let count = 0;
        for (const candidate of ExtendedPagination.ELEMENT_COUNTS) {
            // ボタン 1 個ぶんの幅 (実測したボタン幅 + 左右の余白) × 要素数
            const requiredWidth = candidate * (this.itemWidth + this.itemGap);
            if (requiredWidth > this.availableWidth) {
                break;
            }
            count = candidate;
        }

        return count;
    }

    /**
     * 実際に表示する要素数 (≪, ≫ を含む)
     * 総ページ数が少ないときは存在するページの数だけ表示する
     */
    get elementCount(): number {
        const byWidth = Math.max(this.elementCountByWidth, ExtendedPagination.ELEMENT_COUNTS[0]);

        return Math.min(byWidth, this.maxPage + 2);
    }

    /**
     * 表示するページ番号
     * 現在ページを中央に置き、先頭 / 末尾では表示範囲ごと反対側へずらす
     */
    get pages(): number[] {
        const numberCount = this.elementCount - 2;
        if (numberCount <= 0) {
            return [];
        }

        let startPage = this.currentPage - Math.floor((numberCount - 1) / 2);
        if (startPage < 1) {
            startPage = 1;
        }
        if (startPage + numberCount - 1 > this.maxPage) {
            startPage = this.maxPage - numberCount + 1;
        }
        if (startPage < 1) {
            startPage = 1;
        }

        const pages: number[] = [];
        for (let i = 0; i < numberCount; i++) {
            pages.push(startPage + i);
        }

        return pages;
    }

    /**
     * 入力されたページ番号の検証結果
     */
    get inputErrorMessages(): string[] {
        return this.isInputError === true ? [`1 〜 ${this.maxPage} の整数を入力してください`] : [];
    }

    /**
     * ページ番号を押したときの処理
     * 現在ページならページ数入力ダイアログを開く
     * @param page: number
     */
    public onClickPage(page: number): void {
        if (page === this.currentPage) {
            this.openInputDialog();

            return;
        }

        this.onMovePage(page);
    }

    /**
     * pagination 変更時呼ばれる
     * @param newPage: number
     */
    public onMovePage(newPage: number): void {
        if (this.currentPage === newPage || newPage < 1 || newPage > this.maxPage) {
            return;
        }

        const query = cloneDeep(this.$route.query);
        query.page = newPage.toString(10);

        Util.move(this.$router, {
            path: this.$route.path,
            query: query,
        });
    }

    /**
     * ページ数入力ダイアログを開く
     */
    public openInputDialog(): void {
        this.inputPage = '';
        this.isInputError = false;
        this.isOpenInputDialog = true;

        this.$nextTick(() => {
            if (typeof this.$refs.inputPage !== 'undefined') {
                VuetifyUtil.focusTextFiled(this.$refs.inputPage as Vue);
            }
        });
    }

    /**
     * ページ数入力ダイアログを閉じる
     */
    public closeInputDialog(): void {
        this.isOpenInputDialog = false;
        this.isInputError = false;
    }

    /**
     * 入力欄にフォーカスしたとき、キーボードを除いた可視領域に入るように補正する
     */
    public onInputFocus(): void {
        this.updateVisualViewport();

        // キーボードの表示アニメーションが終わってから位置を確かめる
        setTimeout(() => {
            this.scrollInputIntoView();
        }, ExtendedPagination.KEYBOARD_SETTLE_DELAY);
    }

    /**
     * 入力されたページ番号へ移動する
     * 無効な入力のときはページ遷移しない
     */
    public moveToInputPage(): void {
        if (ExtendedPagination.isValidPage(this.inputPage, this.maxPage) === false) {
            this.isInputError = true;

            return;
        }

        this.isOpenInputDialog = false;
        this.onMovePage(Number(this.inputPage));
    }

    @Watch('inputPage')
    public onInputPageChange(): void {
        this.isInputError = false;
    }

    /**
     * ダイアログの開閉に合わせて可視領域の値を更新する
     * 閉じている最中はキーボードが隠れても位置を固定し、アニメーションが終わってから戻す
     */
    @Watch('isOpenInputDialog')
    public onDialogStateChange(isOpen: boolean): void {
        if (isOpen === true) {
            this.isDialogClosing = false;
            this.updateVisualViewport();

            return;
        }

        this.isDialogClosing = true;
        setTimeout(() => {
            this.isDialogClosing = false;
            this.updateVisualViewport();
        }, ExtendedPagination.DIALOG_TRANSITION_DELAY);
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.currentPage = ExtendedPagination.getPageNum(this.$route.query.page);

        this.$nextTick(() => {
            this.measure();
        });
    }

    /**
     * 可視領域 (visualViewport) に合わせてダイアログの位置と高さを決める
     * visualViewport が無い環境では何もしない (CSS のフォールバック表示になる)
     */
    private updateVisualViewport(): void {
        const viewport = this.visualViewport;
        if (viewport === null || this.isDialogClosing === true) {
            return;
        }

        // キーボードに隠れている高さ (0 なら通常表示)
        const keyboardHeight = Math.max(0, Math.round(window.innerHeight - viewport.height));
        const availableHeight = Math.max(1, Math.floor(viewport.height - ExtendedPagination.VIEWPORT_MARGIN * 2));
        const style = document.documentElement.style;
        style.setProperty('--vk-available-height', `${availableHeight}px`);
        style.setProperty('--vk-keyboard-height', `${keyboardHeight}px`);
        style.setProperty('--vk-offset-top', `${Math.max(0, Math.floor(viewport.offsetTop))}px`);
        this.isVisualViewportActive = true;
    }

    /**
     * visualViewport 用のスタイルを消してフォールバック表示に戻す
     */
    private resetVisualViewport(): void {
        const style = document.documentElement.style;
        style.removeProperty('--vk-available-height');
        style.removeProperty('--vk-keyboard-height');
        style.removeProperty('--vk-offset-top');
        this.isVisualViewportActive = false;
    }

    /**
     * 入力欄が可視領域の外にあるときだけ、見える位置へスクロールする
     */
    private scrollInputIntoView(): void {
        if (this.isOpenInputDialog === false) {
            return;
        }

        const field = this.$refs.inputPage;
        if (typeof field === 'undefined') {
            return;
        }

        const input = ((field as Vue).$el as Element).querySelector('input');
        if (input === null) {
            return;
        }

        const viewport = this.visualViewport;
        const visibleTop = viewport === null ? 0 : viewport.offsetTop;
        const visibleBottom = viewport === null ? window.innerHeight : viewport.offsetTop + viewport.height;
        const rect = input.getBoundingClientRect();
        if (rect.top < visibleTop || rect.bottom > visibleBottom) {
            input.scrollIntoView({ block: 'nearest' });
        }
    }

    /**
     * visualViewport が使える環境では取得する (未対応環境では null)
     */
    private static getVisualViewport(): VisualViewportLike | null {
        const viewport = (window as any).visualViewport as VisualViewportLike | undefined;

        return typeof viewport === 'undefined' || viewport === null ? null : viewport;
    }

    /**
     * ボタン幅と余白、利用可能な横幅を実測する
     * offsetWidth / offsetLeft は transform の影響を受けないので、拡大表示している現在ページがあっても狂わない
     */
    private measure(): void {
        const root = this.$el;
        if (root instanceof HTMLElement === false) {
            return;
        }

        const items = root.querySelector<HTMLElement>('.extended-pagination__items');
        const target = items === null ? root : items;

        const style = window.getComputedStyle(target);
        const paddingLeft = parseFloat(style.paddingLeft);
        const paddingRight = parseFloat(style.paddingRight);
        const padding = (isNaN(paddingLeft) === true ? 0 : paddingLeft) + (isNaN(paddingRight) === true ? 0 : paddingRight);
        this.availableWidth = Math.floor(target.clientWidth - padding);

        const buttons = target.querySelectorAll<HTMLElement>('.extended-pagination__button');
        if (buttons.length >= 2 && buttons[0].offsetWidth > 0) {
            this.itemWidth = buttons[0].offsetWidth;
            // 隣り合うボタンの間隔 (左右の余白の合計) を実測する
            const pitch = buttons[1].offsetLeft - buttons[0].offsetLeft;
            if (pitch > 0) {
                this.itemGap = pitch - this.itemWidth;
            }
        }
    }
}

namespace ExtendedPagination {
    // 横幅に応じて選ぶ要素数 (≪, ≫ を含む)
    export const ELEMENT_COUNTS = [7, 9, 11, 13, 15, 17];

    // 実測できなかった場合に使う値 (ボタン幅と、その左右の余白の合計)
    export const DEFAULT_ITEM_WIDTH = 34;
    export const DEFAULT_ITEM_GAP = 6;

    // ダイアログの上下に確保する余白 (キーボードの高さではない)
    export const VIEWPORT_MARGIN = 12;
    // キーボードの表示アニメーションを待つ時間 (ms)
    export const KEYBOARD_SETTLE_DELAY = 300;
    // ダイアログの開閉アニメーションの時間 (App.vue の page-input-dialog-transition と同じ 0.15s)
    export const DIALOG_TRANSITION_DELAY = 150;

    /**
     * route の query.page から現在ページを取り出す
     * @param page: unknown
     * @return number
     */
    export const getPageNum = (page: unknown): number => {
        const num = typeof page !== 'string' ? 1 : parseInt(page, 10);

        return isNaN(num) === true || num < 1 ? 1 : num;
    };

    /**
     * 1 〜 最終ページの整数かどうか
     * 空欄、0、負数、小数、数字以外は無効として扱う
     * @param value: string
     * @param maxPage: number
     * @return boolean
     */
    export const isValidPage = (value: string, maxPage: number): boolean => {
        if (/^[0-9]+$/.test(value) === false) {
            return false;
        }

        const page = Number(value);

        return page >= 1 && page <= maxPage;
    };
}

export default ExtendedPagination;
</script>

<style lang="sass" scoped>
$item-size: 34px

.extended-pagination
    width: 100%

    &__items
        display: flex
        justify-content: center
        align-items: center
        margin: 4px 0

    // 見た目 (背景色 / 角丸 / 影 / 文字サイズ / 高さ) は既存ページネーションと同じ
    // `v-pagination__item` をそのまま当てて、テーマから色をもらう
    &__button
        display: flex
        justify-content: center
        align-items: center
        width: $item-size
        min-width: $item-size
        height: $item-size
        padding: 0
        border: 0
        // 既存は左右 4.8px。7 要素が 320px 幅の端末でも収まるように 3px に詰める
        margin: 4px 3px
        // 幅が足りないときに縮んで < > と大きさが変わらないようにする
        flex: 0 0 auto
        // 拡大してもレイアウト上の大きさを変えないため、transform を使う
        transform: scale(1)
        transition: transform 0.15s
        line-height: 1
        cursor: pointer

    &__current
        // 他の数字ボタンより約 1.1 倍大きく見せる (レイアウト幅は変えない)
        transform: scale(1.1)

    // 無効状態はページ送りボタンと揃えて暗くし、操作も受け付けない
    &__button--disabled
        opacity: 0.35
        pointer-events: none
        cursor: default
</style>
