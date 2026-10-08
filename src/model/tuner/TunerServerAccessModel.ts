import TunerHttpTransport from './transport/TunerHttpTransport.js';
import { parseConnectionTarget } from './transport/ConnectionTargetParser.js';
import {
    BroadcastType,
    TunerInfo,
    TunerChangeFeedDependencies,
    TunerChangeFeedHandle,
    TunerChangeObserver,
    TunerProgram,
    TunerProgramAudio,
    TunerProgramGenre,
    TunerProgramRelatedItem,
    TunerProgramSeries,
    TunerProgramVideo,
    TunerProgramStreamRequest,
    TunerRequestOptions,
    TunerServerAccess,
    TunerServerStatus,
    TunerService,
    TunerServiceStreamRequest,
    TunerStreamHandle,
} from './types.js';

/**
 * `TunerServerAccessModel`が要求する、REST呼び出しの最小契約。実装は`TunerHttpTransport`。
 * `openStream`が無い（`undefined`の）transportを渡した場合、視聴/録画用streamの取得のみ
 * 利用不可になる（他のREST呼び出しには影響しない）。
 */
export interface TunerRestTransport {
    getJson(path: string, options?: TunerRequestOptions): Promise<unknown>;
    getBuffer(path: string, options?: TunerRequestOptions): Promise<Buffer>;
    openStream?(path: string, priority: number, options?: TunerRequestOptions): Promise<TunerStreamHandle>;
}

interface TunerTimeoutSettings {
    readonly tunerRestRequestTimeoutMs?: unknown;
    readonly tunerStreamEstablishmentTimeoutMs?: unknown;
    readonly changeFeed?: TunerChangeFeedDependencies;
}

const DEFAULT_TUNER_TIMEOUT_MS = 30_000;
const MAX_TUNER_TIMEOUT_MS = 2_147_483_647;

const timeout = (value: unknown): number => {
    if (value === undefined) return DEFAULT_TUNER_TIMEOUT_MS;
    if (!Number.isSafeInteger(value)) throw new Error('Invalid tuner timeout');
    const normalized = value as number;
    if (normalized < 1 || normalized > MAX_TUNER_TIMEOUT_MS) throw new Error('Invalid tuner timeout');
    return normalized;
};

type UnknownRecord = Record<string, unknown>;

const invalidResponse = (): never => {
    throw new Error('Invalid tuner server response');
};

const record = (value: unknown): UnknownRecord => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
    return value as UnknownRecord;
};

const array = (value: unknown): unknown[] => {
    if (!Array.isArray(value)) return invalidResponse();
    return value;
};

const finiteNumber = (value: unknown): number => {
    if (!Number.isFinite(value)) return invalidResponse();
    return value as number;
};

const string = (value: unknown): string => {
    if (typeof value !== 'string') return invalidResponse();
    return value;
};

const boolean = (value: unknown): boolean => {
    if (typeof value !== 'boolean') return invalidResponse();
    return value;
};

const optional = <T>(value: unknown, normalize: (item: unknown) => T): T | undefined =>
    value === undefined ? undefined : normalize(value);

const defined = <T extends UnknownRecord>(value: T): T =>
    Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

/**
 * `TunerInfo.types`（`/api/tuners`のチューナー対応種別）も`TunerService.channel.type`と同じくGR/BS/
 * CS/SKY/BS4Kに限定しない。Mirakurunは`channels.yml`の`type`を実行時検証せずそのまま返すため、この5値
 * 以外の文字列も届き得る。この機能もその値だけを理由に`getTuners()`全体を解析失敗にせず、他の必須
 * 文字列fieldと同じ検査（`string()`、型のみ確認）だけを適用してそのまま通す。`TunerInfo.types`の要素型
 * は`BroadcastType`のままだが、これは`normalizeRelatedItem`が`type as TunerProgramRelatedItem['type']`
 * で行っているのと同じ形の型主張であり、`BroadcastType`はここでは名目上のタグに過ぎない。
 * `reserve.channelType`は必ずしもGR/BS/CS/SKY/BS4Kのいずれかとは限らない。`ReservationManageModel.
 * setTuners`が組み立てる`FindRuleOption`相当の種別チェックボックス（GR/BS/CS/SKY/BS4K）が全て`false`
 * の場合、`ProgramDB.setChannelQuery`は`channelType`列自体を`in`条件へ入れず（`createInQuery`は空配列
 * なら何も追加しない）、その結果`reserve.channelType`には対象チャンネルの実際の種別文字列（未知種別を
 * 含む）がそのまま入る（`ProgramDB.ts`の`setChannelQuery`/`createInQuery`参照）。`Tuner.add()`は
 * `reserve.channelType`と`tuner.types`の文字列一致（`indexOf`）だけで判定するため、この事実（型宣言の
 * みの話）を変えても`ReservationManageModel.ts`・`Tuner.ts`側の判定ロジックを変える必要はない。ただし
 * `tuner.types`の値自体は`ReservationManageModel.setTuners`を経由して`Tuner`
 * （`src/model/operator/reservation/Tuner.ts`）へそのまま渡るため、両fileは本fileの`normalizeTuner`が
 * 返す値と無関係ではない。
 */
const normalizeTuner = (value: unknown): TunerInfo => {
    const source = record(value);
    return {
        index: finiteNumber(source.index),
        name: string(source.name),
        types: array(source.types).map(item => string(item) as BroadcastType),
        isAvailable: boolean(source.isAvailable),
        isRemote: boolean(source.isRemote),
        isFree: boolean(source.isFree),
        isUsing: boolean(source.isUsing),
        isFault: boolean(source.isFault),
    };
};

/**
 * `channel.type`はGR/BS/CS/SKY/BS4K（`BroadcastType`の5値）に限定しない。Mirakurunは`channels.yml`の
 * `type`を実行時検証せずそのまま返すため、この5値以外の文字列も届き得る
 * （`types.ts`の`TunerService.channel`doc参照）。この機能はその値だけを理由に`getServices()`全体を
 * 解析失敗にせず、他の必須文字列fieldと同じ検査（`string()`、型のみ確認）だけを適用してそのまま通す。
 * `TunerService['channel']['type']`の型は`BroadcastType`のままだが、`normalizeRelatedItem`が
 * `type as TunerProgramRelatedItem['type']`で行っているのと同じ形の型主張であり、`BroadcastType`は
 * ここでは名目上のタグに過ぎない（`TunerInfo.types`側も同じ形で`getTuners()`を通す。上の
 * `normalizeTuner`のdoc参照）。
 */
const normalizeChannel = (value: unknown): NonNullable<TunerService['channel']> => {
    const source = record(value);
    return defined({
        type: string(source.type) as BroadcastType,
        channel: string(source.channel),
        name: optional(source.name, string),
    });
};

/**
 * チューナーサーバーが返す放送サービス（チャンネル）情報を、値の型・必須性を検証しながら
 * `TunerService`へ正規化する。optionalな項目は値が`undefined`の場合フィールド自体を省く
 * （`defined`により`undefined`のプロパティを取り除く）。
 * @param value チューナーサーバーからの生JSON値（1サービス分）。
 * @returns 正規化済みの`TunerService`。
 * @throws 必須項目が欠けている、または型が期待と異なる場合。
 */
export const normalizeTunerService = (value: unknown): TunerService => {
    const source = record(value);
    return defined({
        id: finiteNumber(source.id),
        serviceId: finiteNumber(source.serviceId),
        networkId: finiteNumber(source.networkId),
        name: string(source.name),
        type: finiteNumber(source.type),
        logoId: optional(source.logoId, finiteNumber),
        hasLogoData: optional(source.hasLogoData, boolean),
        remoteControlKeyId: optional(source.remoteControlKeyId, finiteNumber),
        epgReady: optional(source.epgReady, boolean),
        epgUpdatedAt: optional(source.epgUpdatedAt, finiteNumber),
        channel: optional(source.channel, normalizeChannel),
    });
};

const normalizeGenre = (value: unknown): TunerProgramGenre => {
    const source = record(value);
    return defined({
        lv1: finiteNumber(source.lv1),
        lv2: optional(source.lv2, finiteNumber),
        un1: optional(source.un1, finiteNumber),
        un2: optional(source.un2, finiteNumber),
    });
};

const normalizeVideo = (value: unknown): TunerProgramVideo => {
    const source = record(value);
    return {
        type: string(source.type),
        resolution: string(source.resolution),
        streamContent: finiteNumber(source.streamContent),
        componentType: finiteNumber(source.componentType),
    };
};

const normalizeAudio = (value: unknown): TunerProgramAudio => {
    const source = record(value);
    return defined({
        componentType: finiteNumber(source.componentType),
        componentTag: optional(source.componentTag, finiteNumber),
        isMain: optional(source.isMain, boolean),
        samplingRate: finiteNumber(source.samplingRate),
        langs: array(source.langs).map(string),
    });
};

const normalizeSeries = (value: unknown): TunerProgramSeries => {
    const source = record(value);
    const expiresAt = source.expiresAt === undefined ? source.expireAt : source.expiresAt;
    return {
        id: finiteNumber(source.id),
        repeat: finiteNumber(source.repeat),
        pattern: finiteNumber(source.pattern),
        expiresAt: finiteNumber(expiresAt),
        episode: finiteNumber(source.episode),
        lastEpisode: finiteNumber(source.lastEpisode),
        name: string(source.name),
    };
};

const normalizeRelatedItem = (value: unknown): TunerProgramRelatedItem => {
    const source = record(value);
    const type = source.type;
    if (type !== undefined && type !== 'shared' && type !== 'relay' && type !== 'movement') return invalidResponse();
    const result: TunerProgramRelatedItem = {
        type: type as TunerProgramRelatedItem['type'],
        networkId: source.networkId === null ? undefined : optional(source.networkId, finiteNumber),
        serviceId: finiteNumber(source.serviceId),
        eventId: finiteNumber(source.eventId),
    };
    return defined(result as TunerProgramRelatedItem & UnknownRecord);
};

const normalizeExtended = (value: unknown): Readonly<Record<string, string>> => {
    if (!Array.isArray(value)) {
        return Object.fromEntries(Object.entries(record(value)).map(([key, text]) => [key, string(text)]));
    }
    return Object.fromEntries(
        value.map(item => {
            const pair = record(item);
            const key = pair.description === undefined ? pair.key : pair.description;
            const text = pair.text === undefined ? pair.value : pair.text;
            return [string(key), string(text)];
        }),
    );
};

/**
 * チューナーサーバーが返す番組情報を`TunerProgram`へ正規化する。Mirakurun/mirakcで細部の
 * フィールド名・形が異なる箇所を吸収する。
 * - `audios`（複数形、配列）と`audio`（単数形、単一object）のどちらでも受け付け、
 *   単一の場合は要素数1の配列へ揃える。
 * - `series.expiresAt`が無ければ`expireAt`（別綴り）を使う。
 * - `extended`（自由記述の追加情報）は配列形式（`{key/description, value/text}`の一覧）と
 *   object形式（keyそのものがproperty名）のどちらでも受け付ける。
 * @param value チューナーサーバーからの生JSON値（1番組分）。
 * @returns 正規化済みの`TunerProgram`。
 * @throws 必須項目が欠けている、または型が期待と異なる場合。
 */
export const normalizeTunerProgram = (value: unknown): TunerProgram => {
    const source = record(value);
    const audioSource = source.audios === undefined ? source.audio : source.audios;
    return defined({
        id: finiteNumber(source.id),
        eventId: finiteNumber(source.eventId),
        serviceId: finiteNumber(source.serviceId),
        networkId: finiteNumber(source.networkId),
        startAt: finiteNumber(source.startAt),
        duration: finiteNumber(source.duration),
        isFree: boolean(source.isFree),
        name: optional(source.name, string),
        description: optional(source.description, string),
        genres: optional(source.genres, value => array(value).map(normalizeGenre)),
        video: optional(source.video, normalizeVideo),
        audios: optional(audioSource, value => (Array.isArray(value) ? value : [value]).map(normalizeAudio)),
        series: optional(source.series, normalizeSeries),
        extended: optional(source.extended, normalizeExtended),
        relatedItems: optional(source.relatedItems, value => array(value).map(normalizeRelatedItem)),
    });
};

const normalizePrograms = (value: unknown): TunerProgram[] => array(value).map(normalizeTunerProgram);

const validId = (value: number): string => {
    if (!Number.isFinite(value)) throw new Error('Invalid tuner server id');
    return encodeURIComponent(String(value));
};

/**
 * チューナーサーバー（Mirakurun/mirakc互換）へのアクセスを提供する。REST呼び出しには
 * 個別にtimeoutを設け、期限超過時は下位の要求を中断（`AbortController`）してから失敗させる。
 * 変更フィード（`openChangeFeed`）は`changeFeed`が設定されている場合のみ利用可能で、
 * 製品判定（Mirakurun/mirakc）の結果に応じて対応するadapterへ振り分ける。
 */
export default class TunerServerAccessModel implements TunerServerAccess {
    /** REST呼び出しの実体。未指定時はconnectionTargetから組み立てた`TunerHttpTransport`。 */
    private readonly transport: TunerRestTransport;
    /** 通常のREST呼び出し（`rest`経由）に適用するtimeout（ミリ秒）。 */
    private readonly restTimeoutMs: number;
    /** 視聴/録画用stream確立（`openStream`経由）に適用するtimeout（ミリ秒）。RESTと別に持つのは、
     *  stream確立が通常のREST応答より時間がかかり得るため。 */
    private readonly streamTimeoutMs: number;
    /** 変更フィード機能の依存一式。未設定（`undefined`）の場合、`openChangeFeed`は例外を投げる。 */
    private readonly changeFeed: TunerChangeFeedDependencies | undefined;

    /**
     * @param connectionTarget 設定ファイルのチューナーサーバー接続先文字列（`parseConnectionTarget`で解釈）。
     * @param userAgent 要求に載せるUser-Agent文字列。
     * @param transport REST呼び出しの実装。未指定時は`connectionTarget`/`userAgent`から生成する。
     * @param settings timeout値・変更フィード依存等の追加設定。
     */
    constructor(
        connectionTarget: string,
        userAgent: string,
        transport?: TunerRestTransport,
        settings: TunerTimeoutSettings = {},
    ) {
        const target = parseConnectionTarget(connectionTarget);
        this.transport = transport ?? new TunerHttpTransport(target, userAgent);
        this.restTimeoutMs = timeout(settings.tunerRestRequestTimeoutMs);
        this.streamTimeoutMs = timeout(settings.tunerStreamEstablishmentTimeoutMs);
        this.changeFeed = settings.changeFeed;
    }

    public async checkAvailability(): Promise<void> {
        record(await this.transport.getJson('/api/status'));
    }

    public async getStatus(options?: TunerRequestOptions): Promise<TunerServerStatus> {
        await this.rest(async request => record(await this.transport.getJson('/api/status', request)), options?.signal);
        const version = await this.rest(
            async request => record(await this.transport.getJson('/api/version', request)),
            options?.signal,
        );
        return { available: true, version: { current: string(version.current), latest: string(version.latest) } };
    }

    public async getTuners(options?: TunerRequestOptions): Promise<TunerInfo[]> {
        return this.rest(
            async request => array(await this.transport.getJson('/api/tuners', request)).map(normalizeTuner),
            options?.signal,
        );
    }

    public async getServices(options?: TunerRequestOptions): Promise<TunerService[]> {
        return this.rest(
            async request => array(await this.transport.getJson('/api/services', request)).map(normalizeTunerService),
            options?.signal,
        );
    }

    public async getPrograms(options?: TunerRequestOptions): Promise<TunerProgram[]> {
        return this.rest(
            async request => normalizePrograms(await this.transport.getJson('/api/programs', request)),
            options?.signal,
        );
    }

    public async getProgramsByService(serviceId: number, options?: TunerRequestOptions): Promise<TunerProgram[]> {
        return this.rest(
            async request =>
                normalizePrograms(
                    await this.transport.getJson(`/api/services/${validId(serviceId)}/programs`, request),
                ),
            options?.signal,
        );
    }

    public async getProgram(programId: number, options?: TunerRequestOptions): Promise<TunerProgram> {
        return this.rest(
            async request =>
                normalizeTunerProgram(await this.transport.getJson(`/api/programs/${validId(programId)}`, request)),
            options?.signal,
        );
    }

    public async getLogo(serviceId: number, options?: TunerRequestOptions): Promise<Buffer> {
        return this.rest(
            request => this.transport.getBuffer(`/api/services/${validId(serviceId)}/logo`, request),
            options?.signal,
        );
    }

    public openProgramStream(request: TunerProgramStreamRequest): Promise<TunerStreamHandle> {
        return this.openStream(
            `/api/programs/${validId(request.programId)}/stream?decode=1`,
            request.priority,
            request.signal,
        );
    }

    public openServiceStream(request: TunerServiceStreamRequest): Promise<TunerStreamHandle> {
        return this.openStream(
            `/api/services/${validId(request.serviceId)}/stream?decode=1`,
            request.priority,
            request.signal,
        );
    }

    public async openChangeFeed(
        observer: TunerChangeObserver,
        options?: TunerRequestOptions,
    ): Promise<TunerChangeFeedHandle> {
        if (this.changeFeed === undefined) throw new Error('Tuner change feed is unavailable');
        const product = await this.changeFeed.detector.detect(options);
        const adapter = product === 'mirakurun' ? this.changeFeed.mirakurun : this.changeFeed.mirakc;
        return adapter.open(observer, options);
    }

    private rest<T>(
        operation: (options: TunerRequestOptions) => T | Promise<T>,
        callerSignal?: AbortSignal,
    ): Promise<T> {
        return this.withDeadline(this.restTimeoutMs, callerSignal, operation);
    }

    private openStream(path: string, priority: number, signal?: AbortSignal): Promise<TunerStreamHandle> {
        if (this.transport.openStream === undefined) throw new Error('Tuner stream transport is unavailable');
        return this.withDeadline(
            this.streamTimeoutMs,
            signal,
            options => this.transport.openStream!(path, priority, options),
            handle => handle.close(),
        );
    }

    private withDeadline<T>(
        timeoutMs: number,
        callerSignal: AbortSignal | undefined,
        operation: (options: TunerRequestOptions) => T | Promise<T>,
        disposeLateValue?: (value: T) => void,
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (callerSignal?.aborted === true) {
                reject(new Error('Tuner request cancelled'));
                return;
            }
            const controller = new AbortController();
            let settled = false;
            const cleanup = (): void => {
                clearTimeout(timer);
                callerSignal?.removeEventListener('abort', onCallerAbort);
            };
            const finish = (error: Error | undefined, value?: T): boolean => {
                if (settled) return false;
                settled = true;
                cleanup();
                if (error !== undefined) reject(error);
                else resolve(value as T);
                return true;
            };
            const onCallerAbort = (): void => {
                controller.abort();
                finish(new Error('Tuner request cancelled'));
            };
            const timer = setTimeout(() => {
                controller.abort();
                finish(new Error(`Tuner request timeout after ${timeoutMs}ms`));
            }, timeoutMs);
            callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
            try {
                void Promise.resolve(operation({ signal: controller.signal })).then(
                    value => {
                        if (finish(undefined, value)) return;
                        if (disposeLateValue === undefined) return;
                        try {
                            disposeLateValue(value);
                        } catch {
                            // The caller has already received its terminal result.
                        }
                    },
                    error => finish(error instanceof Error ? error : new Error('Tuner request failed')),
                );
            } catch (error) {
                finish(error instanceof Error ? error : new Error('Tuner request failed'));
            }
        });
    }
}
