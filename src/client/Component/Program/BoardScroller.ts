import Util from '../../Util/Util';

/**
 * BoardScroller
 * 番組表スクロール処理を行う
 */
class BoardScroller {
    private boardElement: HTMLElement;
    private channelElement: HTMLElement;
    private timeElement: HTMLElement;

    private scrollListener = (() => { this.onScroll(); }).bind(this);
    private mouseDownListener = ((e: MouseEvent) => { this.onMouseDown(e); }).bind(this);
    private mouseUpListener = (() => { this.onMouseUp(); }).bind(this);
    private mouseMoveListener = ((e: MouseEvent) => { this.onMouseMove(e); }).bind(this);

    private isPushed: boolean = false; // 押されているか
    private baseClientX: number = 0;
    private baseClientY: number = 0;

    private isStart: boolean = false;
    private clickTimer: number | null = null;

    private startScroll: (() => void);
    private doneScroll: (() => void);
    private isEnabledScroll: (() => boolean);

    /**
     * scroll 設定をする
     * @param boardElement スクロールする要素
     * @param channelElement 局要素
     * @param timeElement 時間要素
     * @param startCallback: ドラッグ開始コールバック
     * @param doneCallback: ドラッグ完了コールバック
     * @param isEnabledScroll: scroll が有効か確認するコールバック
     */
    public set(
        boardElement: HTMLElement,
        channelElement: HTMLElement,
        timeElement: HTMLElement,
        startCallback: (() => void),
        doneCallback: (() => void),
        isEnabledScroll: (() => boolean),
    ): void {
        this.boardElement = boardElement;
        this.channelElement = channelElement;
        this.timeElement = timeElement;

        this.boardElement.addEventListener('scroll', this.scrollListener, false);

        if (Util.uaIsMobile()) { return; }
        this.startScroll = startCallback;
        this.doneScroll = doneCallback;
        this.isEnabledScroll = isEnabledScroll;

        document.addEventListener('mousedown', this.mouseDownListener, false);
        document.addEventListener('mouseup', this.mouseUpListener, false);
        document.addEventListener('mousemove', this.mouseMoveListener, false);
    }

    /**
     * 削除処理
     * onremove で呼ぶ
     */
    public remove(): void {
        this.boardElement.removeEventListener('scroll', this.scrollListener, false);

        if (Util.uaIsMobile()) { return; }
        document.removeEventListener('mousedown', this.mouseDownListener, false);
        document.removeEventListener('mouseup', this.mouseUpListener, false);
        document.removeEventListener('mousemove', this.mouseMoveListener, false);
    }

    /**
     * scroll
     */
    private onScroll(): void {
        this.channelElement.scrollLeft = this.boardElement.scrollLeft;
        this.timeElement.scrollTop = this.boardElement.scrollTop;
    }

    /**
     * mousedown
     * @param e: MouseEvent
     */
    private onMouseDown(e: MouseEvent): void {
        this.isPushed = true;
        this.baseClientX = e.clientX;
        this.baseClientY = e.clientY;
    }

    /**
     * mouseup
     */
    private onMouseUp(): void {
        this.isPushed = false;
    }

    /**
     * mousemove
     * @param e: MouseEvent
     */
    private onMouseMove(e: MouseEvent): void {
        if (!this.isPushed || this.isEnabledScroll() === false) { return; }

        this.boardElement.scrollLeft += this.baseClientX - e.clientX;
        this.boardElement.scrollTop += this.baseClientY - e.clientY;
        this.baseClientX = e.clientX;
        this.baseClientY = e.clientY;

        if (!this.isStart) {
            this.startScroll();
            this.isStart = true;
        }

        if (this.clickTimer !== null) { clearTimeout(this.clickTimer); }
        this.clickTimer = window.setTimeout(() => {
            this.isStart = false;
            this.doneScroll();
        }, 100);
    }
}

export default BoardScroller;

