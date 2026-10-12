import { Readable } from 'stream';
import { StringDecoder } from 'string_decoder';
import { normalizeTunerProgram, normalizeTunerService } from '../TunerServerAccessModel.js';
import {
    TunerChange,
    TunerChangeAdapter,
    TunerChangeFeedHandle,
    TunerChangeObserver,
    TunerRequestOptions,
} from '../types.js';

/** Mirakurunの変更通知（連結JSON）の生streamを開く関数。`TunerHttpTransport.getStream`を渡す想定。 */
export type MirakurunChangeStreamProvider = (options?: TunerRequestOptions) => Promise<Readable>;

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord => value as UnknownRecord;

const asNumber = (value: unknown): number => {
    if (!Number.isFinite(value)) throw new Error();
    return value as number;
};

/**
 * Mirakurunの変更通知streamは、区切り文字の無い複数のJSON object（`{...}{...}`のように連結された形）
 * が任意のバイト境界で届く。文字単位で走査して`{`/`}`の深さと文字列中のescapeを追いながら、
 * 深さが0に戻るたびに1個のJSON objectとして確定させる、逐次parser。
 */
class JsonObjectFrames {
    private current!: string;
    private depth = 0;
    private escaped!: boolean;
    private inString!: boolean;

    public push(chunk: string): unknown[] {
        const values: unknown[] = [];
        for (const character of chunk) {
            if (this.depth === 0) {
                if (/\s/u.test(character) || character === '[' || character === ']' || character === ',') continue;
                if (character !== '{') throw new Error();
                this.current = character;
                this.depth = 1;
                this.escaped = false;
                this.inString = false;
                continue;
            }

            this.current += character;
            if (this.inString) {
                if (this.escaped) this.escaped = false;
                else if (character === '\\') this.escaped = true;
                else if (character === '"') this.inString = false;
                continue;
            }
            if (character === '"') this.inString = true;
            else if (character === '{') this.depth += 1;
            else if (character === '}') this.depth -= 1;

            if (this.depth === 0) {
                values.push(JSON.parse(this.current));
            }
        }
        return values;
    }

    public hasIncompleteFrame(): boolean {
        return this.depth !== 0;
    }
}

const changeFromFrame = (value: unknown): TunerChange | undefined => {
    const frame = asRecord(value);
    const time = asNumber(frame.time);
    if (typeof frame.resource !== 'string') throw new Error();
    // `program`と`service`以外のresource（`tuner`、およびMirakurun 4系が同じstreamへ流す`job`・`job_schedule`
    // など）は、このアプリでは使わないため読み飛ばす。resourceが増えてもfeedを切らない。
    if (frame.resource !== 'program' && frame.resource !== 'service') return undefined;
    if (frame.resource === 'program') {
        const data = asRecord(frame.data);
        if (frame.type === 'create' || frame.type === 'update') {
            return { kind: 'program', operation: frame.type, program: normalizeTunerProgram(data), time };
        }
        if (frame.type === 'remove') {
            return { kind: 'program', operation: 'remove', programId: asNumber(data.id), time };
        }
        if (frame.type === 'redefine') {
            return {
                kind: 'program',
                operation: 'redefine',
                from: asNumber(data.from),
                to: asNumber(data.to),
                time,
            };
        }
    }
    if (frame.resource === 'service' && ['create', 'update', 'remove'].includes(String(frame.type))) {
        return {
            kind: 'service',
            operation: frame.type as 'create' | 'update' | 'remove',
            service: normalizeTunerService(frame.data),
            time,
        };
    }
    throw new Error();
};

/**
 * Mirakurunが配信する連結JSON形式の変更通知を`TunerChangeAdapter`契約へ正規化する。
 * `resource`（`program`/`service`）と`type`（`create`/`update`/`remove`/`redefine`）の
 * 組み合わせで`TunerChange`へ写像し、それ以外のresource（`tuner`、`job`、`job_schedule`など。このアプリでは
 * 使わない）の通知は`time`を確認したうえで無視する。`program`/`service`の`type`や`data`が不正な通知、
 * `resource`が文字列でない通知は異常として扱う。
 * streamの終端（`end`）到達時、parserに未完了のframe（閉じていないJSON object）が残っていれば
 * 異常終了として扱う（正常終了ならframe境界で綺麗に終わるはずという前提）。
 */
export default class MirakurunChangeAdapter implements TunerChangeAdapter {
    /** 変更通知streamを開く関数（constructor注入）。 */
    private readonly openStream: MirakurunChangeStreamProvider;

    constructor(openStream: MirakurunChangeStreamProvider) {
        this.openStream = openStream;
    }

    /**
     * Mirakurunの変更通知streamを開き、正規化した`TunerChange`を`observer`へ配信し続ける。
     * @param observer 正規化後の変更を受け取るcallback群。
     * @param options streamを開く際に使う共通オプション（`signal`等）。
     * @returns 配信の完了を表す`completion`（異常終了時はreject）と、明示的に閉じる`close`を持つhandle。
     */
    public async open(observer: TunerChangeObserver, options?: TunerRequestOptions): Promise<TunerChangeFeedHandle> {
        const stream = await this.openStream(options);
        const parser = new JsonObjectFrames();
        const decoder = new StringDecoder();
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
            if (!stream.destroyed) stream.destroy();
        };
        const finish = (error?: Error, notifyAborted: boolean = false): void => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error === undefined) resolveCompletion();
            else {
                try {
                    if (notifyAborted) observer.aborted(error);
                } finally {
                    rejectCompletion(error);
                }
            }
        };
        const consumeDecoded = (chunk: string): void => {
            for (const frame of parser.push(chunk)) {
                if (settled) break;
                const change = changeFromFrame(frame);
                if (change !== undefined) observer.changed(change);
            }
        };
        const onData = (chunk: Buffer | string): void => {
            try {
                consumeDecoded(decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            } catch {
                finish(new Error('Invalid Mirakurun change frame'), true);
            }
        };
        const onError = (error: Error): void => finish(error, true);
        const onEnd = (): void => {
            try {
                consumeDecoded(decoder.end());
            } catch {
                finish(new Error('Invalid Mirakurun change frame'), true);
                return;
            }
            if (parser.hasIncompleteFrame()) finish(new Error('Invalid Mirakurun change frame'), true);
            else finish(new Error('Ended tuner change feed'));
        };
        const onClose = (): void => finish(new Error('Closed tuner change feed'));
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
