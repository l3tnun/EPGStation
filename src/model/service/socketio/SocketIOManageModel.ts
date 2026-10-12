import * as http from 'http';
import { inject, injectable } from 'inversify';
import { Server as SocketIOServer } from 'socket.io';
import urljoin from 'url-join';
import IConfigFile from '../../IConfigFile.js';
import IConfiguration from '../../IConfiguration.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import ISocketIOManageModel from './ISocketIOManageModel.js';

/**
 * `ISocketIOManageModel` の実装。socket.io server を各 `http.Server`（複数listen先ぶん）に
 * 被せて初期化し、client への状態変更通知を行う。短時間に連続で呼ばれても実際の emit は
 * 200ms に1回へ間引く（`notifyClient`/`notifyUpdateEncodeProgress` それぞれ独立に）。
 */
@injectable()
export default class SocketIOManageModel implements ISocketIOManageModel {
    private log: ILogger;
    private config: IConfigFile;
    /** `initialize` で構築した、`http.Server` それぞれに対応する socket.io server 一覧。 */
    private ios: SocketIOServer[] = [];
    /** `notifyClient` の間引き用timer。稼働中は`null`以外になり、発火すると`null`に戻る。 */
    private callTimer: NodeJS.Timer | null = null;
    /** `notifyUpdateEncodeProgress` の間引き用timer。役割は `callTimer` と同様。 */
    private encodeProgressCallTimer: NodeJS.Timer | null = null;

    constructor(@inject('ILoggerModel') logger: ILoggerModel, @inject('IConfiguration') configuration: IConfiguration) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
    }

    /**
     * socket.io 初期化
     * @param servers: http.Server[]
     */
    public initialize(servers: http.Server[]): void {
        for (const s of servers) {
            this.ios.push(
                new SocketIOServer(s, {
                    path:
                        typeof this.config.subDirectory === 'undefined'
                            ? '/socket.io'
                            : urljoin(this.config.subDirectory, '/socket.io'),
                    cors: {
                        origin: '*',
                    },
                }),
            );
        }

        this.log.system.info('SocketIO Server has started.');
    }

    /**
     * client へ状態変更通知
     */
    public notifyClient(): void {
        if (this.callTimer === null) {
            this.callTimer = setTimeout(() => {
                this.callTimer = null;

                if (this.ios.length === 0) {
                    throw new Error('must call SocketIoManageModel initialize');
                }

                for (const io of this.ios) {
                    try {
                        io.sockets.emit('updateStatus');
                    } catch (error: unknown) {
                        this.log.system.error(error);
                    }
                }
            }, 200);
        }
    }

    /**
     * エンコードの進捗情報更新を通知
     */
    public notifyUpdateEncodeProgress(): void {
        if (this.encodeProgressCallTimer === null) {
            this.encodeProgressCallTimer = setTimeout(() => {
                this.encodeProgressCallTimer = null;

                if (this.ios.length === 0) {
                    throw new Error('must call SocketIoManageModel initialize');
                }

                for (const io of this.ios) {
                    try {
                        io.sockets.emit('updateEncode');
                    } catch (error: unknown) {
                        this.log.system.error(error);
                    }
                }
            }, 200);
        }
    }
}
