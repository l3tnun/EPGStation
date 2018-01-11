import * as m from 'mithril';
import Model from '../Model';
import BalloonStatus from './BallonStatus';

interface BalloonModelInterface extends Model {
    add(id: string): void;
    open(id: string): void;
    close(): void;
    isOpen(id: string): boolean;
}

class BalloonModel extends Model implements BalloonModelInterface {
    private balloons: { [key: string]: BalloonStatus } = {};

    /**
    * 管理するバルーンを追加
    * @param id: string
    */
    public add(id: string): void {
        if(typeof this.balloons[id] === 'undefined') {
            this.balloons[id] = new BalloonStatus();
        }
    }

    /**
    * 指定した id のバルーンを開く
    * @param id: string
    * @throws BalloonIsNotFound 指定された id のバルーンがなかった場合
    */
    public open(id: string): void {
        if(typeof this.balloons[id] === 'undefined') {
            throw new Error(BalloonModel.balloonIsNotFound);
        }

        this.balloons[id].open();
        m.redraw();
    }

    /**
    * すべてのバルーンを閉じる
    */
    public close(): void {
        let needsRedraw = false;
        for(let key in this.balloons) {
            if(this.balloons[key].get()) {
                this.balloons[key].close();
                needsRedraw = true;
            }
        }
        if(needsRedraw) { m.redraw(); }
    }

    /**
    * 指定された id のバルーンが開いているか
    * @param id: string
    * @throws BalloonIsNotFound 指定された id のバルーンがなかった場合
    * @return true: open, false: close
    */
    public isOpen(id: string): boolean {
        if(typeof this.balloons[id] === 'undefined') {
            throw new Error(BalloonModel.balloonIsNotFound);
        }

        return this.balloons[id].get();
    }
}

namespace BalloonModel {
    export const balloonIsNotFound = 'BalloonIsNotFound';
}

export { BalloonModelInterface, BalloonModel };

