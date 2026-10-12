import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface UnixSocketListener {
    /** 接続を受け付けた回数。 */
    accepted(): number;
    /** 待受けを止め、socket を置いた一時 directory を消す。 */
    close(): Promise<void>;
    readonly socketPath: string;
}

/**
 * UNIX domain socket で待ち受け、接続が来るたびに数えて直ちに閉じる server を起動する。
 * MySQL の handshake は返さないので、接続した側の初期化は失敗するが、接続が socket に届いたことは観測できる。
 */
export const listenOnUnixSocket = async (): Promise<UnixSocketListener> => {
    const directory = await mkdtemp(join(tmpdir(), 'epgs-sock-'));
    const socketPath = join(directory, 'mysqld.sock');
    const sockets = new Set<Socket>();
    let acceptedCount = 0;
    const server: Server = createServer(socket => {
        acceptedCount += 1;
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.destroy();
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, resolve);
    });
    return {
        accepted: () => acceptedCount,
        close: async () => {
            for (const socket of sockets) {
                socket.destroy();
            }
            await new Promise<void>(resolve => server.close(() => resolve()));
            await rm(directory, { force: true, recursive: true });
        },
        socketPath,
    };
};
