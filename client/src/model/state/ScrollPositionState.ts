import { EventEmitter2 } from 'eventemitter2';
import { injectable } from 'inversify';
import Util from '../../util/Util';
import IScrollPositionState from './IScrollPositionState';

interface History {
    id: number | null; // timestamp query を格納する (timestamp query は一意のため)
    url: string;
    data: any | null;
}

@injectable()
class ScrollPositionState implements IScrollPositionState {
    /**
     * スクロール位置の復元が必要な場合は true になる
     * 復元が終わったら false にすること
     */
    public isNeedRestoreHistory: boolean = false;

    private history: History[] | null = null;
    private currentPosition: number = -1;
    private event: EventEmitter2 = new EventEmitter2();

    /**
     * スクロール情報を格納する
     * @param data: any
     */
    public saveScrollData(data: any): void {
        if (this.history === null || typeof this.history[this.currentPosition] === 'undefined') {
            console.error('history save error');
            throw new Error('HistorySaveError');
        }

        this.history[this.currentPosition].data = data;
        this.saveStorage();
    }

    /**
     * sessionStorage に history を保存
     */
    private saveStorage(): void {
        window.sessionStorage.setItem(
            ScrollPositionState.STORAGE_KEY,
            JSON.stringify({
                history: this.history,
                curentPosition: this.currentPosition,
            }),
        );
    }

    /**
     * history から保存したスクロール情報を取り出す
     * @return T | null
     */
    public getScrollData<T>(): T | null {
        if (this.history === null) {
            throw new Error('HistoryIsNull');
        }

        return this.history[this.currentPosition].data as T;
    }

    /**
     * history 情報をセットする
     */
    public updateHistoryPosition(): void {
        if (this.history === null) {
            this.restoreHistory();
            this.isNeedRestoreHistory = true;
        }

        if (this.history === null) {
            console.error('history is null');
            return;
        }

        // 前回値クリア
        this.isNeedRestoreHistory = false;

        const id = this.getTimestampQuery();
        const newPosition = this.history.findIndex(h => {
            return h.id === id;
        });

        if (newPosition === -1) {
            this.currentPosition += 1;
            if (typeof this.history[this.currentPosition] !== 'undefined') {
                this.history = this.history.splice(0, this.currentPosition);
            }

            this.history.push({
                id: this.getTimestampQuery(),
                url: location.href,
                data: null,
            });
        } else {
            this.currentPosition = newPosition;
            this.isNeedRestoreHistory = true;
        }

        this.saveStorage();
    }

    /**
     * history を復元
     */
    private restoreHistory(): void {
        const str = window.sessionStorage.getItem(ScrollPositionState.STORAGE_KEY);
        if (str === null) {
            this.history = [];
            this.currentPosition = -1;

            return;
        }

        const data = JSON.parse(str) as any;
        this.history = data.history;
        this.currentPosition = data.position;
    }

    /**
     * timestamp query を取得
     * @return number | null
     */
    private getTimestampQuery(): number | null {
        const value = Util.getQueryParam(location.href, ScrollPositionState.TIMESTAMP_PARAM);

        return value === null ? null : parseInt(value, 10);
    }

    /**
     * vue router にスクロール位置を復元させるための関数
     * データ取得等が完了しスクロール位置をもとに戻せる状態になったらこの関数を呼ぶ
     * @return Promise<void>
     */
    public async emitDoneGetData(): Promise<void> {
        await this.event.emitAsync(ScrollPositionState.DONE_GET_DATA_EVENT);
    }

    /**
     * vue router scrollBehavior() 内で使用される
     * emitDoneGetData() が呼ばれるまで待つ
     * @param timeout: number タイムアウト時間 (秒)
     *                 デフォルト値 5
     */
    public async onDoneGetData(timeout: number = 5): Promise<void> {
        return new Promise<void>((reslove, reject) => {
            const timer = setTimeout(() => {
                this.event.removeAllListeners();
                reject();
            }, timeout * 1000);

            this.event.once(ScrollPositionState.DONE_GET_DATA_EVENT, () => {
                clearTimeout(timer);
                reslove();
            });
        });
    }
}

namespace ScrollPositionState {
    export const STORAGE_KEY = 'historyInfo';
    export const TIMESTAMP_PARAM = 'timestamp';
    export const DONE_GET_DATA_EVENT = 'doneGetData';
}

export default ScrollPositionState;
