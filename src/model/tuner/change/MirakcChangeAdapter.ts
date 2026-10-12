import { Readable } from 'stream';
import {
    TunerChange,
    TunerChangeAdapter,
    TunerChangeFeedHandle,
    TunerChangeObserver,
    TunerRequestOptions,
} from '../types.js';

/** mirakcの変更通知（Server-Sent Events）の生streamを開く関数。`TunerHttpTransport.getStream`を渡す想定。 */
export type MirakcChangeStreamProvider = (options?: TunerRequestOptions) => Promise<Readable>;

const serviceIdFromData = (data: string): number => {
    const value = JSON.parse(data) as Record<string, unknown>;
    const serviceId = value.serviceId;
    if (!Number.isFinite(serviceId)) throw new Error();
    return serviceId as number;
};

/**
 * mirakcが配信するServer-Sent Events形式の変更通知を`TunerChangeAdapter`契約へ正規化する。
 * mirakcは番組単位の粒度で通知しないため、`onair.program-changed`イベントを
 * `on-air-service`（サービス単位の変更として粗く扱う）、`epg.programs-updated`イベントを
 * `service-programs-updated`へ写像する。後者はEPG再構成時に大量連発されるため、
 * サービスごとに最初の1回から1秒以内の重複通知は間引く（`firstEpgNotificationAt`で判定）。
 * また、streamがdata無しで無応答のまま切断されたことを検知するため、1秒間隔でstreamの
 * 生存を監視する（`onData`/`onEnd`/`onClose`のいずれも発火しない切断パターンへの対策）。
 */
export default class MirakcChangeAdapter implements TunerChangeAdapter {
    /** 変更通知streamを開く関数（constructor注入）。 */
    private readonly openStream: MirakcChangeStreamProvider;
    /** 現在時刻の取得口（test時は固定時刻に差し替える）。既定は`Date.now`。 */
    private readonly now: () => number;

    constructor(openStream: MirakcChangeStreamProvider, now: () => number = Date.now) {
        this.openStream = openStream;
        this.now = now;
    }

    /**
     * mirakcの変更通知streamを開き、正規化した`TunerChange`を`observer`へ配信し続ける。
     * @param observer 正規化後の変更を受け取るcallback群。
     * @param options streamを開く際に使う共通オプション（`signal`等）。
     * @returns 配信の完了を表す`completion`（異常終了時はreject）と、明示的に閉じる`close`を持つhandle。
     */
    public async open(observer: TunerChangeObserver, options?: TunerRequestOptions): Promise<TunerChangeFeedHandle> {
        const stream = await this.openStream(options);
        let buffer = '';
        let firstEpgNotificationAt: number | undefined;
        let settled = false;
        let resolveCompletion!: () => void;
        let rejectCompletion!: (error: Error) => void;
        const completion = new Promise<void>((resolve, reject) => {
            resolveCompletion = resolve;
            rejectCompletion = reject;
        });
        const cleanup = (): void => {
            stream.removeListener('data', onData);
            stream.removeListener('error', onError);
            stream.removeListener('end', onEnd);
            stream.removeListener('close', onClose);
            clearInterval(monitor);
            if (!stream.destroyed) stream.destroy();
        };
        const finish = (error?: Error): void => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error === undefined) resolveCompletion();
            else {
                try {
                    observer.aborted(error);
                } finally {
                    rejectCompletion(error);
                }
            }
        };
        const emitFrame = (frame: string): void => {
            let event: string | undefined;
            const data: string[] = [];
            for (const line of frame.split(/\r?\n/u)) {
                if (line.startsWith('event:')) event = line.slice('event:'.length).trimStart();
                else if (line.startsWith('data:')) data.push(line.slice('data:'.length));
            }
            if (event !== 'onair.program-changed' && event !== 'epg.programs-updated') return;
            const serviceId = serviceIdFromData(data.join('\n'));
            let change: TunerChange;
            if (event === 'onair.program-changed') {
                change = { kind: 'on-air-service', serviceId };
            } else {
                const current = this.now();
                if (firstEpgNotificationAt === undefined) firstEpgNotificationAt = current;
                if (current - firstEpgNotificationAt <= 1_000) return;
                change = { kind: 'service-programs-updated', serviceId };
            }
            observer.changed(change);
        };
        const onData = (chunk: Buffer | string): void => {
            try {
                buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
                const frames = buffer.split(/\r?\n\r?\n/u);
                buffer = frames.pop()!;
                for (const frame of frames) {
                    emitFrame(frame);
                    if (settled) break;
                }
            } catch {
                finish(new Error('Invalid mirakc change frame'));
            }
        };
        const onError = (error: Error): void => finish(error);
        const onEnd = (): void => finish(new Error('Ended mirakc change feed'));
        const onClose = (): void => finish(new Error('Closed mirakc change feed'));
        const monitor = setInterval(() => {
            if (stream.destroyed || stream.readable === false) {
                finish(new Error('Closed mirakc change feed'));
            }
        }, 1_000);
        stream.on('data', onData);
        stream.once('error', onError);
        stream.once('end', onEnd);
        stream.once('close', onClose);
        try {
            observer.started();
        } catch (error) {
            cleanup();
            throw error;
        }
        return { completion, close: () => finish() };
    }
}
