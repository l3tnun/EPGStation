import * as m from 'mithril';
import Model from '../Model';
import BalloonStatus from './BallonStatus';

interface BalloonModelInterface extends Model {
    add(id: string): void;
    open(id: string): void;
    setCloseCallback(id: string, callback: () => void): void;
    close(id?: string): void;
    forceToCloseAll(): void;
    isOpen(id: string): boolean;
    disableClose(): void;
    enableClose(): void;
    regDisableCloseAllId(id: string): void;
}

class BalloonModel extends Model implements BalloonModelInterface {
    private balloons: { [key: string]: BalloonStatus } = {};
    private isDisabledClose: boolean = false;
    private disabledCloseAllIds: { [key: string]: boolean } = {};

    /**
     * 管理するバルーンを追加
     * @param id: string
     */
    public add(id: string): void {
        if (typeof this.balloons[id] === 'undefined') {
            this.balloons[id] = new BalloonStatus();
        }
    }

    /**
     * 指定した id のバルーンを開く
     * @param id: string
     * @throws BalloonIsNotFound 指定された id のバルーンがなかった場合
     */
    public open(id: string): void {
        if (typeof this.balloons[id] === 'undefined') {
            throw new Error(BalloonModel.balloonIsNotFound);
        }

        this.balloons[id].open();
        m.redraw();
    }

    /**
     * close 時に実行する callback を登録
     * @param id: id
     * @param allback: () => void
     */
    public setCloseCallback(id: string, callback: () => void): void {
        if (typeof this.balloons[id] === 'undefined') {
            throw new Error(BalloonModel.balloonIsNotFound);
        }

        this.balloons[id].setCallback(callback);
    }

    /**
     * バルーンを閉じる
     * @param id: string id を指定して閉じる場合は指定する
     */
    public close(id?: string): void {
        if (this.isDisabledClose) { return; }

        let needsRedraw = false;

        if (typeof id === 'undefined') {
            for (const key in this.balloons) {
                if (!!this.disabledCloseAllIds[key]) { continue; }

                if (this.balloons[key].get()) {
                    this.balloons[key].close();
                    needsRedraw = true;
                }
            }
        } else if (typeof this.balloons[id] !== 'undefined') {
            this.balloons[id].close();
            needsRedraw = true;
        }
        if (needsRedraw) { m.redraw(); }
    }

    /**
     * バルーンを強制的に全て閉じる
     */
    public forceToCloseAll(): void {
        for (const key in this.balloons) {
            this.balloons[key].close();
        }

        m.redraw();
    }

    /**
     * 指定された id のバルーンが開いているか
     * @param id: string
     * @throws BalloonIsNotFound 指定された id のバルーンがなかった場合
     * @return true: open, false: close
     */
    public isOpen(id: string): boolean {
        if (typeof this.balloons[id] === 'undefined') {
            throw new Error(BalloonModel.balloonIsNotFound);
        }

        return this.balloons[id].get();
    }

    /**
     * close を無効化
     */
    public disableClose(): void {
        this.isDisabledClose = true;
    }

    /**
     * close を有効化
     */
    public enableClose(): void {
        this.isDisabledClose = false;
    }

    /**
     * close id 指定なしの時に close しない id を設定
     * @param id: string
     */
    public regDisableCloseAllId(id: string): void {
        this.disabledCloseAllIds[id] = true;
    }
}

namespace BalloonModel {
    export const balloonIsNotFound = 'BalloonIsNotFound';
}

export { BalloonModelInterface, BalloonModel };

