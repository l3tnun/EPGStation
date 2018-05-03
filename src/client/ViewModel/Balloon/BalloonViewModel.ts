import { BalloonModelInterface } from '../../Model/Balloon/BallonModel';
import ViewModel from '../ViewModel';

class BalloonViewModel extends ViewModel {
    private model: BalloonModelInterface;
    private event: Event;

    constructor(model: BalloonModelInterface) {
        super();
        this.model = model;
    }

    /**
     * init
     */
    public init(): void {
        super.init();
        this.model.close();
    }

    /**
     * 管理するバルーンを追加
     * @param id: string
     */
    public add(id: string): void {
        this.model.add(id);
    }

    /**
     * 指定した id のバルーンを開く
     * @param id: string
     * @param event: onclick の event (表示位置を設定するため)
     * @throws BalloonIsNotFound 指定された id のバルーンがなかった場合
     */
    public open(id: string, event: Event | null = null): void {
        if (event !== null) { this.event = event; }
        this.model.open(id);
    }

    /**
     * すべてのバルーンを閉じる
     * @param id: string id を指定して閉じる場合は指定する
     */
    public close(id?: string): void {
        this.model.close(id);
    }

    /**
     * 指定された id のバルーンが開いているか
     * @param id: string
     * @throws BalloonIsNotFound 指定された id のバルーンがなかった場合
     * @return true: open, false: close
     */
    public isOpen(id: string): boolean {
        return this.model.isOpen(id);
    }

    /**
     * open でセットされた event を返す
     * @return event: Event
     */
    public getEvent(): Event {
        return this.event;
    }
}

export default BalloonViewModel;

