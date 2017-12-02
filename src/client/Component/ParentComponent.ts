import * as m from 'mithril';
import * as socketIo from 'socket.io-client';
import Component from './Component';
import { ViewModelStatus } from '../Enums';
import Util from '../Util/Util';
import factory from '../ViewModel/ViewModelFactory';
import BalloonViewModel from '../ViewModel/Balloon/BalloonViewModel';
import * as events from '../IoEvents';
import StreamInfoViewModel from '../ViewModel/Stream/StreamInfoViewModel';

interface queryInterface {
    [key: string]: any;
}

interface History {
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

    private static ioStatus: { [key: string]: { isActive: boolean, isInited: boolean } } = {};
    private static io: SocketIOClient.Socket | null = null;

    private static isSettedPopstate: boolean = false;
    private static history: History[] | null = null;
    private static historyPosition: number = 0;
    private static isBack: boolean = false;
    private static isForward: boolean = false;

    constructor() {
        super();
        this._balloon = <BalloonViewModel>(factory.get('BalloonViewModel'));
        this._streamInfo = <StreamInfoViewModel>(factory.get('StreamInfoViewModel'))

        if(!ParentComponent.isSettedPopstate) {
            ParentComponent.isSettedPopstate = true;
             window.addEventListener('popstate', () => {
                if(ParentComponent.history === null) { return; }

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
    */
    protected saveHistoryData(data: any): void {
        if(ParentComponent.history === null) {
            throw new Error('history is null');
        }

        ParentComponent.history[ParentComponent.historyPosition].data = data;
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
    * status に状態が入る
    */
    protected initViewModel(status: ViewModelStatus = 'init'): void {
        setTimeout(() => {
            this._streamInfo.init(status);

            // set history
            if(status === 'init' || status === 'update') {
                if(ParentComponent.history === null) {
                    ParentComponent.history = [{
                        url: location.href,
                        data: null,
                    }];
                    ParentComponent.historyPosition = 0;
                } else if(ParentComponent.isBack && ParentComponent.historyPosition - 1 >= 0 && ParentComponent.history[ParentComponent.historyPosition - 1].url === location.href) {
                    // back
                    ParentComponent.historyPosition -= 1;
                    ParentComponent.isBack = false;
                } else if(ParentComponent.isForward && ParentComponent.historyPosition + 1 <= ParentComponent.history.length - 1 && ParentComponent.history[ParentComponent.historyPosition + 1].url === location.href) {
                    // forward
                    ParentComponent.historyPosition += 1;
                    ParentComponent.isForward = false;
                } else if(ParentComponent.history[ParentComponent.historyPosition].url !== location.href) {
                    // new page
                    ParentComponent.historyPosition += 1;

                    if (typeof ParentComponent.history[ParentComponent.historyPosition] !== 'undefined') {
                        ParentComponent.history = ParentComponent.history.splice(0, ParentComponent.historyPosition);
                    }

                    ParentComponent.history.push({
                        url: location.href,
                        data: null,
                    });
                }
            }
        }, 0);
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
        ParentComponent.ioStatus[this.getComponentName()].isActive = false;
        return super.onremove(vnode);
    }

    protected abstract getComponentName(): string;

    public abstract view(vnode: m.Vnode<T, any>): m.Children | null | void;
}

export default ParentComponent;

