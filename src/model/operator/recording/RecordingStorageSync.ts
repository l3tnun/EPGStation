import * as fs from 'fs';

/**
 * 録画ファイルとディレクトリの内容を記憶装置へ書き出す（fsync）。
 * OS の page cache へ渡っただけの内容は電源断や OS の停止で失われ得るので、録画の完了を記録・通知する前と、
 * 一時録画先のファイルを消す前に書き出す。
 */
namespace RecordingStorageSync {
    /** 録画終了時に録画ファイルの writer の終了（'close'）を待つ上限 */
    export const WRITER_CLOSE_TIMEOUT_MS = 60_000;
    /** 書き出し一回を待つ上限 */
    export const SYNC_TIMEOUT_MS = 60_000;
    /** 書き出しが失敗したときに試みる合計回数 */
    export const SYNC_ATTEMPTS = 3;
    /** 書き出しを試み直すまでの間隔 */
    export const SYNC_RETRY_INTERVAL_MS = 1000;

    /**
     * 書き出しの結果
     * synced: 書き出せた
     * failed: 合わせて SYNC_ATTEMPTS 回失敗した
     * timed-out: 一回の書き出しが SYNC_TIMEOUT_MS 以内に終わらなかった
     * unsupported: filesystem が書き出しに対応しない
     * missing: 書き出す対象が無い
     */
    export type Result = 'synced' | 'failed' | 'timed-out' | 'unsupported' | 'missing';

    /** filesystem が書き出しに対応しないことを表す error code */
    const UNSUPPORTED_CODES: ReadonlySet<string | undefined> = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP']);

    /**
     * ファイルを開いて書き出し、閉じる
     * @param filePath: 書き出すファイル
     */
    export const syncFile = async (filePath: string): Promise<void> => {
        const handle = await fs.promises.open(filePath, 'r+');
        try {
            await handle.sync();
        } finally {
            await handle.close();
        }
    };

    /**
     * ディレクトリを開いて書き出し、閉じる。Windows ではディレクトリを開けないので何もしない
     * @param directoryPath: 書き出すディレクトリ
     */
    export const syncDirectory = async (directoryPath: string): Promise<void> => {
        if (process.platform === 'win32') return;
        const handle = await fs.promises.open(directoryPath, 'r');
        try {
            await handle.sync();
        } finally {
            await handle.close();
        }
    };

    /**
     * operation が SYNC_TIMEOUT_MS 以内に終われば終わり方を返す。時間切れなら 'timed-out' を返し、後から確定した
     * operation の結果は使わない（reject も下の handler が受けるので未処理にならない）
     */
    const attempt = (operation: () => Promise<void>): Promise<{ error: unknown } | 'done' | 'timed-out'> => {
        const pending = operation();
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve('timed-out'), SYNC_TIMEOUT_MS);
            pending.then(
                () => {
                    clearTimeout(timer);
                    resolve('done');
                },
                (error: unknown) => {
                    clearTimeout(timer);
                    resolve({ error });
                },
            );
        });
    };

    /**
     * 書き出しを試み、結果を返す。例外は投げない。'synced' 以外は log へ警告を一回記録する
     * @param target: 書き出す対象（log に記録する）
     * @param operation: 一回の書き出し
     * @param log: 警告の記録先
     */
    export const sync = async (
        target: string,
        operation: () => Promise<void>,
        log: { warn(message: string): void },
    ): Promise<Result> => {
        for (let count = 1; ; count++) {
            const outcome = await attempt(operation);
            if (outcome === 'done') return 'synced';
            if (outcome === 'timed-out') {
                log.warn(`storage sync timed out: ${target}`);
                return 'timed-out';
            }

            const code = (outcome.error as NodeJS.ErrnoException | null)?.code;
            if (code === 'ENOENT') {
                log.warn(`storage sync target is missing: ${target}`);
                return 'missing';
            }
            if (UNSUPPORTED_CODES.has(code)) {
                log.warn(`storage sync is not supported: ${target} (${code})`);
                return 'unsupported';
            }
            if (count >= SYNC_ATTEMPTS) {
                log.warn(`storage sync failed: ${target} (${String(outcome.error)})`);
                return 'failed';
            }
            await new Promise(resolve => setTimeout(resolve, SYNC_RETRY_INTERVAL_MS));
        }
    };
}

export default RecordingStorageSync;
