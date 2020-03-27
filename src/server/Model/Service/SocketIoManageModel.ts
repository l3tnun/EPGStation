import * as http from 'http';
import * as SocketIO from 'socket.io';
// tslint:disable-next-line:no-require-imports
import urljoin = require('url-join');
import * as events from '../../IoEvents';
import Util from '../../Util/Util';
import Model from '../Model';

interface SocketIoManageModelInterface extends Model {
    initialize(server: http.Server): void;
    notifyClient(): void;
}

/**
 * SocketIoManageModel
 * socket.io の設定を行う
 */
class SocketIoManageModel extends Model implements SocketIoManageModelInterface {
    private io: SocketIO.Server | null = null;
    private callTimer: NodeJS.Timer | null = null;

    /**
     * http.Server セット
     * @param server: http.Server
     */
    public initialize(server: http.Server): void {
        const subDirectory = Util.getSubDirectory();
        this.io = SocketIO(server, {
            origins: '*:*',
            path: subDirectory === null ? '/socket.io' : urljoin(subDirectory, '/socket.io'),
        });

        this.log.system.info('SocketIo Server has started.');
    }

    /**
     * socket を返す
     * @return SocketIO.Namespace
     */
    private getSockets(): SocketIO.Namespace {
        if (this.io === null) {
            throw new Error('must call SocketIoManageModel initialize');
        }

        return this.io.sockets;
    }

    /**
     * client へ状態の更新を通知する
     */
    public notifyClient(): void {
        if (this.callTimer === null) {
            this.callTimer = setTimeout(() => {
                this.callTimer = null;
                this.getSockets().emit(events.updateStatus);
            }, 200);
        }
    }
}

export { SocketIoManageModel, SocketIoManageModelInterface };

