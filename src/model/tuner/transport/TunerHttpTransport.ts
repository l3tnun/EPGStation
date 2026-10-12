import { ClientRequest, IncomingMessage, RequestOptions, request as nodeRequest } from 'node:http';
import { posix } from 'node:path';
import { Readable } from 'node:stream';
import { ConnectionTarget } from '../types.js';
import { TunerRequestOptions, TunerStreamHandle } from '../types.js';

/** `node:http`の`request`と同じ形の関数型。testでは差し替えて実際の通信を発生させない。 */
export type TunerHttpRequest = (
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
) => ClientRequest;

type ResponseKind = 'buffer' | 'stream' | 'probe';

type ResponseOutcome = { readonly redirect: string } | { readonly value: unknown };

const drain = (response: IncomingMessage): Promise<void> =>
    new Promise((resolve, reject) => {
        const cleanup = (): void => {
            response.removeListener('end', onEnd);
            response.removeListener('error', onFailure);
            response.removeListener('close', onFailure);
        };
        const onEnd = (): void => {
            cleanup();
            resolve();
        };
        const onFailure = (): void => {
            cleanup();
            reject(new Error('Tuner response failed'));
        };
        response.once('end', onEnd);
        response.once('error', onFailure);
        response.once('close', onFailure);
        response.resume();
    });

const collect = (response: IncomingMessage): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        const cleanup = (): void => {
            response.removeListener('data', onData);
            response.removeListener('end', onEnd);
            response.removeListener('error', onFailure);
            response.removeListener('close', onFailure);
        };
        const onData = (chunk: Buffer | string): void => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        };
        const onEnd = (): void => {
            cleanup();
            resolve(Buffer.concat(chunks));
        };
        const onFailure = (): void => {
            cleanup();
            reject(new Error('Tuner response failed'));
        };
        response.on('data', onData);
        response.once('end', onEnd);
        response.once('error', onFailure);
        response.once('close', onFailure);
    });

/**
 * チューナーサーバー（Mirakurun/mirakc互換）へのHTTP GET要求を、接続方式（TCP/UNIXソケット/
 * 名前付きパイプ）の違いを吸収して行う低レベルtransport。redirect（301〜399）は自動で1回追跡し、
 * `/api/...`配下以外のroute（`isRootRoute`指定を除く）や正規化前後で変わるpathは要求前に拒否する。
 */
export default class TunerHttpTransport {
    /** 接続先（host/port、またはsocketPath）と、その正規化済みbasePath。 */
    private readonly target: Readonly<ConnectionTarget>;
    /** 要求ヘッダーへ載せるUser-Agent文字列。 */
    private readonly userAgent: string;
    /** 実際にHTTP要求を発行する関数（既定は`node:http`の`request`、testでは差し替える）。 */
    private readonly request: TunerHttpRequest;

    constructor(target: Readonly<ConnectionTarget>, userAgent: string, request: TunerHttpRequest = nodeRequest) {
        this.target = target;
        this.userAgent = userAgent;
        this.request = request;
    }

    /**
     * 応答bodyをJSONとしてparseして返す。
     * @param path 要求path（`/api/...`）。
     * @param options 中断用の`signal`等の共通オプション。
     * @returns parse済みのJSON値。
     */
    public async getJson(path: string, options?: TunerRequestOptions): Promise<unknown> {
        return this.get(path, undefined, options);
    }

    /**
     * 応答bodyを生のBufferとして返す（画像等、JSONでない応答向け）。
     * @param path 要求path。
     * @param options 中断用の`signal`等の共通オプション。
     * @returns 応答bodyのBuffer。
     */
    public async getBuffer(path: string, options?: TunerRequestOptions): Promise<Buffer> {
        return (await this.get(path, 'buffer', options)) as Buffer;
    }

    /**
     * 応答bodyを読み切らず、streamのまま返す。
     * @param path 要求path。
     * @param options 中断用の`signal`等の共通オプション。
     * @returns 応答本体のReadable stream。
     */
    public async getStream(path: string, options?: TunerRequestOptions): Promise<Readable> {
        return (await this.get(path, 'stream', options)) as Readable;
    }

    /**
     * `basePath`を付けず、また`/api/`配下チェックも行わずにstreamを取得する。変更通知フィード等、
     * `/api/`配下に収まらないrouteのために`isRootRoute`を立てて呼ぶ。
     * @param path 要求path（`basePath`を含まない、絶対path扱い）。
     * @param options 中断用の`signal`等の共通オプション。
     * @returns 応答本体のReadable stream。
     */
    public async getRootStream(path: string, options?: TunerRequestOptions): Promise<Readable> {
        return (await this.get(path, 'stream', options, {}, false, false, true)) as Readable;
    }

    /**
     * 通常のエラー扱いにはせず、HTTPステータスと（あれば）bodyだけを返す要求。
     * 製品判定（`ProductDetector`）のように、404自体が意味を持つ判定に使う。
     * @param path 要求path。
     * @param options 中断用の`signal`等の共通オプション。
     * @returns 応答ステータスコードと、JSONとしてparseできた場合のbody。
     */
    public async probeJson(
        path: string,
        options?: TunerRequestOptions,
    ): Promise<{ readonly status: number; readonly body?: unknown }> {
        return (await this.get(path, 'probe', options)) as { readonly status: number; readonly body?: unknown };
    }

    /**
     * 視聴/録画用のストリーム配信を開く。`X-Mirakurun-Priority`ヘッダーで優先度を伝え、
     * 応答を読み切らずに保持したまま、明示的に`close`されるまで開いたままにする。
     * @param path 要求path。
     * @param priority チューナー割り当ての優先度（`X-Mirakurun-Priority`ヘッダーの値）。
     * @param options 中断用の`signal`等の共通オプション。
     * @returns streamと、それを閉じるための`close`を持つhandle。
     */
    public async openStream(path: string, priority: number, options?: TunerRequestOptions): Promise<TunerStreamHandle> {
        return (await this.get(
            path,
            'stream',
            options,
            { 'X-Mirakurun-Priority': String(priority) },
            true,
        )) as TunerStreamHandle;
    }

    private composePath(route: string, isRedirect: boolean, isRootRoute: boolean): string {
        const queryIndex = route.indexOf('?');
        const pathname = queryIndex === -1 ? route : route.slice(0, queryIndex);
        const query = queryIndex === -1 ? '' : route.slice(queryIndex);
        const normalizedRoute = posix.normalize(pathname);
        if (normalizedRoute !== pathname || (!isRedirect && !isRootRoute && !normalizedRoute.startsWith('/api/'))) {
            throw new Error('Invalid tuner API route');
        }
        const basePath = isRootRoute ? '' : this.target.basePath;
        return `${basePath}${normalizedRoute}${query}`;
    }

    private requestOptions(
        path: string,
        headers: Readonly<Record<string, string>>,
        isRedirect: boolean,
        isRootRoute: boolean,
    ): RequestOptions {
        const common: RequestOptions = {
            method: 'GET',
            path: this.composePath(path, isRedirect, isRootRoute),
            headers: { 'User-Agent': this.userAgent, ...headers },
        };
        return this.target.kind === 'http'
            ? { ...common, host: this.target.host, port: this.target.port }
            : { ...common, socketPath: this.target.socketPath };
    }

    private get(
        path: string,
        kind?: ResponseKind,
        requestOptions?: TunerRequestOptions,
        headers: Readonly<Record<string, string>> = {},
        returnHandle: boolean = false,
        isRedirect: boolean = false,
        isRootRoute: boolean = false,
    ): Promise<unknown> {
        return new Promise((resolve, reject) => {
            let options: RequestOptions;
            try {
                options = this.requestOptions(path, headers, isRedirect, isRootRoute);
            } catch (error) {
                reject(error);
                return;
            }
            let request: ClientRequest | undefined;
            let response: IncomingMessage | undefined;
            let settled = false;
            let requestDestroyed = false;
            let responseDestroyed = false;
            let destroyOwnedRequest = (): void => {};
            const cleanupRequestError = (): void => {
                request?.removeListener('error', rejectRequest);
            };
            const destroyRequest = (): void => {
                if (requestDestroyed) return;
                requestDestroyed = true;
                try {
                    destroyOwnedRequest();
                } catch {
                    // The first terminal result is already fixed; cleanup failures must not replace it.
                }
            };
            const destroyResponse = (): void => {
                if (response === undefined || responseDestroyed) return;
                responseDestroyed = true;
                if (response.destroyed) return;
                try {
                    response.destroy();
                } catch {
                    // The first terminal result is already fixed; cleanup failures must not replace it.
                }
            };
            const cleanup = (keepTerminalRequestErrorListener: boolean): void => {
                if (!keepTerminalRequestErrorListener) {
                    cleanupRequestError();
                    request!.removeListener('close', cleanupRequestError);
                }
                requestOptions?.signal?.removeEventListener('abort', abortRequest);
            };
            const finish = (error: Error | undefined, value?: unknown): void => {
                if (settled) return;
                settled = true;
                if (error !== undefined) {
                    destroyRequest();
                    destroyResponse();
                }
                cleanup(error !== undefined);
                if (error !== undefined) reject(error);
                else resolve(value);
            };
            const rejectRequest = (): void => {
                finish(new Error('Tuner request failed'));
            };
            const abortRequest = (): void => {
                finish(new Error('Tuner request cancelled'));
            };
            if (requestOptions?.signal?.aborted === true) {
                finish(new Error('Tuner request cancelled'));
                return;
            }
            try {
                request = this.request(options, incoming => {
                    response = incoming;
                    if (settled) {
                        destroyResponse();
                        return;
                    }
                    void this.handleResponse(kind, incoming).then(
                        outcome => {
                            if ('redirect' in outcome) {
                                cleanup(false);
                                settled = true;
                                void this.get(
                                    outcome.redirect,
                                    kind,
                                    requestOptions,
                                    headers,
                                    returnHandle,
                                    true,
                                    isRootRoute,
                                ).then(resolve, reject);
                                return;
                            }
                            if (returnHandle) {
                                const handle: TunerStreamHandle = {
                                    stream: incoming,
                                    close: () => {
                                        destroyRequest();
                                        destroyResponse();
                                    },
                                };
                                finish(undefined, handle);
                                return;
                            }
                            finish(undefined, outcome.value);
                        },
                        error => finish(error instanceof Error ? error : new Error('Tuner response failed')),
                    );
                });
                destroyOwnedRequest = () => request!.destroy();
                request.once('error', rejectRequest);
                request.once('close', cleanupRequestError);
                requestOptions?.signal?.addEventListener('abort', abortRequest, { once: true });
                request.end();
            } catch {
                rejectRequest();
            }
        });
    }

    private async handleResponse(kind: ResponseKind | undefined, response: IncomingMessage): Promise<ResponseOutcome> {
        const statusCode = response.statusCode;
        if (statusCode === undefined) {
            await drain(response);
            throw new Error('Tuner response has no status code');
        }
        if (statusCode >= 301 && statusCode <= 399) {
            const location = response.headers.location;
            await drain(response);
            if (location === undefined || !location.startsWith('/') || location.startsWith('//')) {
                throw new Error('Invalid tuner redirect');
            }
            return { redirect: location };
        }
        if (kind === 'probe' && statusCode === 404) {
            await drain(response);
            return { value: { status: statusCode } };
        }
        if (statusCode < 200 || statusCode > 202) {
            await drain(response);
            throw new Error(`Tuner request failed with status ${statusCode}`);
        }
        if (kind === 'stream') return { value: response };
        const body = await collect(response);
        if (kind === 'buffer') return { value: body };
        try {
            const value = JSON.parse(body.toString('utf8'));
            return { value: kind === 'probe' ? { status: statusCode, body: value } : value };
        } catch {
            throw new Error('Invalid tuner JSON response');
        }
    }
}
