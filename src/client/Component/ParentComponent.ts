import * as m from 'mithril';
import { debounce } from 'lodash';
import * as socketIo from 'socket.io-client';
import Component from './Component';
import { ViewModelStatus } from '../Enums';
import Util from '../Util/Util';
import factory from '../ViewModel/ViewModelFactory';
import BalloonViewModel from '../ViewModel/Balloon/BalloonViewModel';
import * as events from '../IoEvents';
import StreamInfoViewModel from '../ViewModel/Stream/StreamInfoViewModel';
import MainLayoutComponent from './MainLayoutComponent';

interface queryInterface {
    [key: string]: any;
}

interface History {
    id: number | null; // dummy query を格納する (dummy query は一意のため)
    url: string;
    data: any | null;
}

/**
* query が変わるたびに iniViewtModel が呼ばれる component
* 親 component で使われることを想定している
*/
abstract class ParentComponent<T> extends Component<T> {
    private query: queryInterface = {}
    private newQuery: queryInterface = {}
    private queryChanged: boolean = false;
    private _balloon: BalloonViewModel;
    private _streamInfo: StreamInfoViewModel;
    private _resizeListener = debounce(() => { this._balloon.close(); }, 100);

    private static ioStatus: { [key: string]: { isActive: boolean, isInited: boolean } } = {};
    private static io: SocketIOClient.Socket | null = null;

    private static isSettedPopstate: boolean = false;
    private static history: History[] | null = null;
    private static historyPosition: number = 0;
    private static isBack: boolean = false;
    private static isForward: boolean = false;
    private static isPopstate: boolean = false;

    protected isNeedRestorePosition: boolean = false;

    constructor() {
        super();
        this._balloon = <BalloonViewModel>(factory.get('BalloonViewModel'));
        this._streamInfo = <StreamInfoViewModel>(factory.get('StreamInfoViewModel'))

        if(!ParentComponent.isSettedPopstate) {
            ParentComponent.isSettedPopstate = true;
             window.addEventListener('popstate', () => {
                if(ParentComponent.history === null) { return; }

                ParentComponent.isPopstate = true;

                const back = ParentComponent.history[ParentComponent.historyPosition - 1];
                const forward = ParentComponent.history[ParentComponent.historyPosition + 1];
                const current = location.href;
                if(typeof back !== 'undefined' && back.url === current) {
                    ParentComponent.isBack = true;
                    ParentComponent.isForward = false;
                } else if(typeof forward !== 'undefined' && forward.url === current) {
                    ParentComponent.isBack = false;
                    ParentComponent.isForward = true;
                } else {
                    ParentComponent.isBack = false;
                    ParentComponent.isForward = false;
                }
            });
        }
    }

    /**
    * history に データを記憶
    * @param data: any
    */
    protected saveHistoryData(data: any): void {
        if(ParentComponent.history === null) {
            throw new Error('history is null');
        }

        ParentComponent.history[ParentComponent.historyPosition].data = data;
        this.saveStorage();
    }

    /**
    * history からデータを取り出す
    */
    protected getHistoryData(): T | null {
        if(ParentComponent.history === null) {
            throw new Error('history is null');
        }

        return <T>ParentComponent.history[ParentComponent.historyPosition].data;
    }

    /**
    * initViewModel
    * @param status: ViewModelStatus
    */
    protected initViewModel(status: ViewModelStatus = 'init'): void {
        setTimeout(() => {
            this._streamInfo.init(status);

            // set history
            if(status === 'init' || status === 'update') {
                if(ParentComponent.history === null) {
                    this.restoreHistory();
                } else if(ParentComponent.isBack) {
                    // back
                    ParentComponent.historyPosition -= 1;
                    ParentComponent.isBack = false;
                } else if(ParentComponent.isForward) {
                    // forward
                    ParentComponent.historyPosition += 1;
                    ParentComponent.isForward = false;
                } else if(ParentComponent.isPopstate && !ParentComponent.isBack && !ParentComponent.isForward) {
                    // ブラウザで一気に戻る or 進んだ場合
                    // dummy query を使用して該当位置を検索する
                    const id = this.getDummyQuery()
                    const newPosition = ParentComponent.history.findIndex((h) => {
                        return h.id === id;
                    });

                    if(newPosition !== -1) {
                        ParentComponent.historyPosition = newPosition;
                    }
                } else if(ParentComponent.history[ParentComponent.historyPosition].url !== location.href) {
                    // new page
                    ParentComponent.historyPosition += 1;

                    if (typeof ParentComponent.history[ParentComponent.historyPosition] !== 'undefined') {
                        ParentComponent.history = ParentComponent.history.splice(0, ParentComponent.historyPosition);
                    }

                    ParentComponent.history.push({
                        id: this.getDummyQuery(),
                        url: location.href,
                        data: null,
                    });
                }

                ParentComponent.isPopstate = false;
                this.saveStorage();
            }
        }, 0);
    }

    /**
    * sessionStorage に history を保存
    */
    private saveStorage(): void {
        window.sessionStorage.setItem(ParentComponent.storageKey, JSON.stringify({
            history: ParentComponent.history,
            position: ParentComponent.historyPosition,
        }));
    }

    /**
    * history を復元
    */
    private restoreHistory(): void {
        const str = window.sessionStorage.getItem(ParentComponent.storageKey);
        if(str === null) {
            ParentComponent.history = [{
                id: this.getDummyQuery(),
                url: location.href,
                data: null,
            }];
            ParentComponent.historyPosition = 0;
            return;
        }

        const data = <any>JSON.parse(str);
        ParentComponent.history = data.history;
        ParentComponent.historyPosition = data.position;
    }

    /**
    * dummy query を返す
    * @return number | null
    */
    private getDummyQuery(): number | null {
        const dummy = m.route.param('dummy');
        return typeof dummy === 'undefined' ? null : Number(dummy);
    }

    /**
    * isNeedResorePosition をセットする initViewModel の最後で呼び出す
    * @param status: ViewModelStatus
    */
    protected setRestorePositionFlag(status: ViewModelStatus): void {
        if(status === 'init' || status === 'update') {
            this.isNeedRestorePosition = true;
            m.redraw();
        }
    }

    /**
    * MainLayout での scroll position を復元する
    * onupdate で呼び出す
    */
    protected restoreMainLayoutPosition(): void {
        if(!this.isNeedRestorePosition) { return; }

        this.isNeedRestorePosition = false;
        const scrollTop = <number | null>this.getHistoryData();
        if(scrollTop === null) { return; }

        const main = document.getElementById(MainLayoutComponent.id);
        if(main !== null) { main.scrollTop = scrollTop; }
    }

    /**
    * query を記憶
    */
    public oninit(_vnode: m.Vnode<T, any>): any {
        this.query = Util.getCopyQuery();
        this.queryChanged = false;
        this.initViewModel('init');

        if(typeof ParentComponent.ioStatus[this.getComponentName()] === 'undefined') {
            ParentComponent.ioStatus[this.getComponentName()] = { isActive: false, isInited: false };
        }

        ParentComponent.ioStatus[this.getComponentName()].isActive = true;

        //一度だけ socket.io の接続を行う
        if(ParentComponent.io === null) {
            ParentComponent.io = socketIo.connect(window.location.protocol + '//' + window.location.host);
            // socket.io 切断時の設定
            this.disconnectIo(ParentComponent.io);
        }

        //各 ParentComponent で socketio の設定をする
        if(!ParentComponent.ioStatus[this.getComponentName()].isInited) {
            ParentComponent.ioStatus[this.getComponentName()].isInited = true;

            // server から状態の変更が通知された
            ParentComponent.io.on(events.updateStatus, () => {
                if(ParentComponent.ioStatus[this.getComponentName()].isActive) {
                    this.initViewModel('updateIo');
                }
            });

            //再接続時
            ParentComponent.io.on('reconnect', () => {
                if(ParentComponent.ioStatus[this.getComponentName()].isActive) {
                    setTimeout(() => { this.initViewModel('reload'); }, 300);
                }
            });
        }
    }

    /**
    * socket.io 切断時の設定
    */
    private disconnectIo(io: SocketIOClient.Socket): void {
        let movePage = false;
        window.onunload = () => {};
        window.onpageshow = (event) => { if (event.persisted) { window.location.reload(); } };

        window.onbeforeunload = (event) => {
            event = event || window.event;
            movePage = true;
        }

        //切断時 背景を黒くする
        let busy: Element | null = null;
        io.on('disconnect', () => {
            if(movePage || busy != null) { return; }
            //接続が切断された
            busy = document.createElement('div');
            busy.setAttribute('class', 'disconnect-background');
            document.body.appendChild(busy);
        });

        //再接続時 背景を戻す
        io.on('reconnect', () => {
            this._balloon.close();
            if(busy != null) { setTimeout(() => { document.body.removeChild(busy!); busy = null; }, 300);  }
        });
    }

    /**
    * oncreate
    */
    public oncreate(vnode: m.VnodeDOM<T, this>): any {
        super.oncreate(vnode);

        // window resize 時に balloon を閉じる
        window.addEventListener('resize', this._resizeListener, false);
    }

    /**
    * ViewModeel の init が必要であるかチェック
    * 必要であれば this.queryChanged = true;
    */
    public onbeforeupdate(_vnode: m.VnodeDOM<T, any>, _old: m.VnodeDOM<T, any>): boolean | void {
        this.newQuery = Util.getCopyQuery();
        if(m.buildQueryString(this.newQuery) == m.buildQueryString(this.query)) { return; }
        this.queryChanged = true;
    }

    /**
    * update
    * this.queryChanged === true なら initViewModel
    */
    public onupdate(_vnode: m.VnodeDOM<T, any>): void {
        // query の変更で initViewModel する場合は state を適宜変更する
        if(this.queryChanged) {
            // close balloon
            setTimeout(() => { this._balloon.close(); }, 0);
            // init viewModel
            setTimeout(() => { this.initViewModel('update'); }, 0);
        }
        this.query = this.newQuery;
        this.queryChanged = false;
    }

    public async onbeforeremove(vnode: m.VnodeDOM<T, any>): Promise<any>{
        // close balloon
        // setTimeout で遅らせないと次のページで constructor が２度呼ばれてしまう
        await new Promise<void>((resolve: () => void) => {
            setTimeout(() => {
                this._balloon.close();
                resolve();
            }, 0);
        })

        return super.onbeforeremove(vnode);
    }

    public onremove(vnode: m.VnodeDOM<T, any>): any {
        window.removeEventListener('resize', this._resizeListener, false );

        ParentComponent.ioStatus[this.getComponentName()].isActive = false;
        return super.onremove(vnode);
    }

    protected abstract getComponentName(): string;

    public abstract view(vnode: m.Vnode<T, any>): m.Children | null | void;
}

namespace ParentComponent {
    export const storageKey = 'historyInfo';
}

export default ParentComponent;

