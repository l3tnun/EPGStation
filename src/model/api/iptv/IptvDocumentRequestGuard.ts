import { Response } from 'express';
import { IptvRequestContext } from './IIPTVApiModel.js';

// IPTV向けドキュメント（m3u8/XMLTV）生成に許す最大時間。これを超えたら生成処理の途中でも
// 打ち切り、`failure`を呼ぶ（`ensureActive`が例外を投げることで生成側の処理を中断させる）。
const IPTV_DOCUMENT_DEADLINE_MS = 30_000;
const DEADLINE_ERROR_MESSAGE = 'IptvDocumentRequestDeadlineExceeded';
const TERMINATED_ERROR_MESSAGE = 'IptvDocumentRequestTerminated';

/** `completeIptvDocumentRequest`の呼び出し元が渡す、生成処理そのものと結果の受け取り方。 */
export interface IptvDocumentRequestOptions<T> {
    /** ドキュメント本体を生成する処理。`context.ensureActive()`を適宜呼ぶことで、
     *  途中経過でも打ち切り（timeout・応答close）を検知できる。 */
    execute(context: IptvRequestContext): Promise<T> | T;
    /** 生成が打ち切られた、または`execute`が例外を投げた場合に呼ばれる。 */
    failure(error: unknown): void;
    /** `execute`が正常に完了した場合に、結果を渡して呼ばれる。 */
    success(result: T): void;
}

/**
 * IPTV向けドキュメント生成1件を、応答の生存期間（HTTP接続がcloseされていないか）とtimeout
 * （`IPTV_DOCUMENT_DEADLINE_MS`）の両方で監視しながら実行する。`execute`/`success`/`failure`の
 * いずれか1回だけが呼ばれることを保証し（`settled`フラグで多重解決を防ぐ）、応答が既に
 * closeされている場合は`execute`すら呼ばずに完了扱いにする。呼び出し元（`channel.m3u8.ts`・
 * `epg.xml.ts`）は、実際のHTTP応答の書き込み（`success`/`failure`側）をこの関数の外で行う。
 * @param res 監視対象のExpress応答オブジェクト（`close`イベントの購読、`destroyed`/`writableEnded`
 *            状態の確認に使う）。
 * @param options 生成処理本体と、成功・失敗時のcallback。
 * @returns 生成処理が完了（成功・失敗いずれか、または応答closeによる中断）したら解決するPromise。
 *          `success`/`failure`が例外を投げた場合はこのPromise自体がrejectする。
 */
export const completeIptvDocumentRequest = <T>(
    res: Response,
    options: IptvDocumentRequestOptions<T>,
): Promise<void> => {
    const deadline = globalThis.performance.now() + IPTV_DOCUMENT_DEADLINE_MS;
    let settled = false;
    let deadlineTimer: NodeJS.Timeout | undefined;
    let resolveCompletion!: () => void;
    let rejectCompletion!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
    });

    const cleanup = (): void => {
        if (deadlineTimer !== undefined) {
            clearTimeout(deadlineTimer);
            deadlineTimer = undefined;
        }
        res.removeListener('close', onResponseClose);
    };
    const settle = (commit?: () => void): boolean => {
        if (settled) return false;
        settled = true;
        cleanup();
        try {
            commit?.();
            resolveCompletion();
        } catch (error: unknown) {
            rejectCompletion(error);
        }
        return true;
    };
    const fail = (error: unknown): void => {
        settle(() => options.failure(error));
    };
    const failDeadline = (): void => {
        fail(new Error(DEADLINE_ERROR_MESSAGE));
    };
    const ensureActive = (): void => {
        if (settled) throw new Error(TERMINATED_ERROR_MESSAGE);
        if (globalThis.performance.now() >= deadline) {
            failDeadline();
            throw new Error(DEADLINE_ERROR_MESSAGE);
        }
    };
    const onResponseClose = (): void => {
        settle();
    };

    res.once('close', onResponseClose);
    if (res.destroyed === true || res.writableEnded === true) {
        settle();
        return completion;
    }

    const remaining = deadline - globalThis.performance.now();
    if (remaining <= 0) {
        failDeadline();
        return completion;
    }
    deadlineTimer = setTimeout(failDeadline, Math.ceil(remaining));

    let operation: Promise<T>;
    try {
        operation = Promise.resolve(options.execute({ ensureActive }));
    } catch (error: unknown) {
        if (globalThis.performance.now() >= deadline) failDeadline();
        else fail(error);
        return completion;
    }

    void operation.then(
        result => {
            if (globalThis.performance.now() >= deadline) failDeadline();
            else settle(() => options.success(result));
        },
        error => {
            if (globalThis.performance.now() >= deadline) failDeadline();
            else fail(error);
        },
    );

    return completion;
};
