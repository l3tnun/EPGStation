import * as http from 'http';
import * as socketio from 'socket.io';
import * as events from '../../IoEvents';
import Model from '../Model';

interface SocketIoManageModelInterface extends Model {
    initialize(server: http.Server): void;
    getSockets(): SocketIO.Namespace;
    notifyClient(): void;
}

/**
 * SocketIoManageModel
 * socket.io の設定を行う
 */
class SocketIoManageModel extends Model implements SocketIoManageModelInterface {
    private io: SocketIO.Server | null = null;

    /**
     * http.Server セット
     * @param server: http.Server
     */
    public initialize(server: http.Server): void {
        this.io = socketio(server);

        this.log.system.info('SocketIo Server has started.');
    }

    /**
     * socket を返す
     * @return SocketIO.Namespace
     */
    public getSockets(): SocketIO.Namespace {
        if (this.io === null) {
            throw new Error('must call SocketIoManageModel initialize');
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

export { SocketIoManageModel, SocketIoManageModelInterface };

