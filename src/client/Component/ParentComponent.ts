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
    [key: string]: any,
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

    constructor() {
        super();
        this._balloon = <BalloonViewModel>(factory.get('BalloonViewModel'));
        this._streamInfo = <StreamInfoViewModel>(factory.get('StreamInfoViewModel'))
    }

    /**
    * initViewModel
    * status に状態が入る
    */
    protected initViewModel(status: ViewModelStatus = 'init'): void {
        setTimeout(() => { this._streamInfo.init(status); }, 0);
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

