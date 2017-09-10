import * as http from 'http';
import * as socketio from 'socket.io';
import Base from '../Base';
import * as events from '../IoEvents';

/**
* SocketIoServer
* socket.io の設定を行う
*/
class SocketIoServer extends Base {
    private static instance: SocketIoServer;
    private io: SocketIO.Server | null = null;

    public static getInstance(): SocketIoServer {
        if(!this.instance) {
            this.instance = new SocketIoServer();
        }

        return this.instance;
    }

    private constructor() { super(); }

    public initialize(server: http.Server): void {
        this.io = socketio(server);

        this.log.system.info('SocketIo Server has started.');
        this.io.sockets.on('connection', (_socket: SocketIO.Socket) => {
        });
    }

    /**
    * socket を返す
    * @return SocketIO.Namespace
    */
    public getSockets(): SocketIO.Namespace {
        if(this.io == null) {
            throw new Error('must call SocketIoServer initialize');
        }

        return this.io.sockets;
    }

    /**
    * client へ状態の更新を通知する
    */
    public notifyClient(): void {
        this.getSockets().emit(events.updateStatus);
    }
}

export default SocketIoServer;

