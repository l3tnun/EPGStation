import * as http from 'http';
import { inject, injectable } from 'inversify';
import * as SocketIO from 'socket.io';
import urljoin from 'url-join';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import ISocketIOManageModel from './ISocketIOManageModel';

@injectable()
export default class SocketIOManageModel implements ISocketIOManageModel {
    private log: ILogger;
    private config: IConfigFile;
    private io: SocketIO.Server | null = null;
    private callTimer: NodeJS.Timer | null = null;

    constructor(@inject('ILoggerModel') logger: ILoggerModel, @inject('IConfiguration') configuration: IConfiguration) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
    }

    /**
     * socket.io 初期化
     * @param server: http.Server
     */
    public initialize(server: http.Server): void {
        this.io = SocketIO.default(server, {
            path:
                typeof this.config.subDirectory === 'undefined'
                    ? '/socket.io'
                    : urljoin(this.config.subDirectory, '/socket.io'),
        });

        this.log.system.info('SocketIO Server has started.');
    }

    /**
     * client へ状態変更通知
     */
    public notifyClient(): void {
        if (this.callTimer === null) {
            this.callTimer = setTimeout(() => {
                this.callTimer = null;
                this.getSockets().emit('updateStatus');
            }, 200);
        }
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
}
