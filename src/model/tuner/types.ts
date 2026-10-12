/** チューナーサーバー（Mirakurun / mirakc）が発行するサービスの識別子。サーバー側の実装に依存する不透明な数値で、EPGStation側では意味を解釈せず、そのままAPIパスや比較キーとして使う。 */
export type TunerServerId = number;
/** チューナーサーバーが発行する番組（EPGイベント）の識別子。番組が再定義（redefine）されると値が変わり得るため、永続的な番組同一性の保証にはならない。 */
export type ProgramId = number;
/** 放送波の種別。地上波（GR）、BS、CS、SKYサービス（CSの一部）、BS4Kのいずれか。この5値が既知の種別で、それ以外の文字列は未知種別として扱う（`getChannelTypeId`のdefault分岐等）。 */
export type BroadcastType = 'GR' | 'BS' | 'CS' | 'SKY' | 'BS4K';

/**
 * チューナーサーバーへの接続方法を表す判別共用体。`kind`で接続経路を切り替える。
 * - `http`: TCP経由のHTTP接続（host/portを直接指定）。
 * - `unix`: UNIXドメインソケット経由（`http+unix://`や`http://unix:`形式の設定文字列から解決）。
 * - `named-pipe`: Windowsの名前付きパイプ経由。
 * いずれも`basePath`はチューナーサーバーのbase URL相当の接頭辞（末尾スラッシュ無し、rootの場合は空文字）。
 * `transport/ConnectionTargetParser.ts`の`parseConnectionTarget`が設定文字列からこの型を組み立てる。
 */
export type ConnectionTarget =
    | { readonly kind: 'http'; readonly host: string; readonly port: number; readonly basePath: string }
    | { readonly kind: 'unix'; readonly socketPath: string; readonly basePath: string }
    | { readonly kind: 'named-pipe'; readonly socketPath: string; readonly basePath: string };

/**
 * `/api/status`と`/api/version`への疎通結果。`getStatus`が両エンドポイントを呼んで合成する。
 * `available`は常に`true`固定（呼び出しが失敗した場合は例外を投げるため、この型が返る時点で到達可能であることが確定している）。
 */
export interface TunerServerStatus {
    readonly available: true;
    readonly version: {
        readonly current: string;
        readonly latest: string;
    };
}

/** チューナーサーバーが持つ物理/仮想チューナー1台分の状態。`/api/tuners`の1要素。 */
export interface TunerInfo {
    readonly index: number;
    readonly name: string;
    /**
     * `types`の型は`BroadcastType`（GR/BS/CS/SKY/BS4Kの5値）だが、実行時に届く値はこの5値に限らない。
     * Mirakurunは`channels.yml`の`type`を実行時検証せずそのまま返すため、この5値以外の文字列も届き得る
     * （`TunerService.channel`のdoc、`normalizeTuner`のdoc参照）。GR/BS/CS/SKY/BS4K以外であることだけ
     * を理由に`getTuners()`全体を解析失敗にしない。
     */
    readonly types: BroadcastType[];
    readonly isAvailable: boolean;
    readonly isRemote: boolean;
    readonly isFree: boolean;
    readonly isUsing: boolean;
    readonly isFault: boolean;
}

/**
 * チューナーサーバーが把握する放送サービス（チャンネル）1件。`/api/services`の1要素。
 * `logoId`以降のoptionalなfieldは、チューナーサーバーの応答に含まれない場合は省略される
 * （`normalizeTunerService`が`undefined`のfieldを結果から取り除くため、キー自体が無いことと値が無いことは同じ意味）。
 */
export interface TunerService {
    readonly id: TunerServerId;
    readonly serviceId: number;
    readonly networkId: number;
    readonly name: string;
    readonly type: number;
    readonly logoId?: number;
    readonly hasLogoData?: boolean;
    readonly remoteControlKeyId?: number;
    readonly epgReady?: boolean;
    readonly epgUpdatedAt?: number;
    /**
     * `channel.type`の型は`BroadcastType`（GR/BS/CS/SKY/BS4Kの5値）だが、実行時に届く値はこの5値に限
     * らない。mirakcの`ChannelType`はBS4Kを持ち（mirakc-core/src/models.rs）、Mirakurunも
     * `channels.yml`の`type`を実行時検証せずそのまま返すため、チューナーサーバー側の設定次第でこの5値
     * 以外の文字列も届き得る。`normalizeChannel`（`TunerServerAccessModel.ts`）はGR/BS/CS/SKY/BS4K以外
     * であることだけを理由に`getServices()`全体を解析失敗にせず、他の必須文字列fieldと同じ型検査だけを
     * 適用して文字列をそのまま通す（`BroadcastType`型はここでは名目上のタグに過ぎない）。保存側
     * （`ChannelDB.getChannelTypeId`）はGR/BS/CS/SKY/BS4Kの5値に`channelTypeId`0/1/2/3/5を割り当て、
     * それ以外は未知種別として`channelTypeId`4で保存する。
     */
    readonly channel?: {
        readonly type: BroadcastType;
        readonly channel: string;
        readonly name?: string;
    };
}

/**
 * EPG番組情報1件。`/api/programs`系エンドポイントの1要素。
 * `name`以降のoptionalなfieldは、放送局が該当情報を送出していない場合に省略され得る
 * （`TunerService`と同様、`normalizeTunerProgram`が`undefined`のfieldを取り除く）。
 */
export interface TunerProgram {
    readonly id: ProgramId;
    readonly eventId: number;
    readonly serviceId: number;
    readonly networkId: number;
    readonly startAt: number;
    readonly duration: number;
    readonly isFree: boolean;
    readonly name?: string;
    readonly description?: string;
    readonly genres?: TunerProgramGenre[];
    readonly video?: TunerProgramVideo;
    readonly audios?: TunerProgramAudio[];
    readonly series?: TunerProgramSeries;
    readonly extended?: Readonly<Record<string, string>>;
    readonly relatedItems?: TunerProgramRelatedItem[];
}

/** 番組のジャンルコード（ARIB規定のジャンル大分類/中分類、および利用者定義ジャンル）。値が無い分類は省略される。 */
export interface TunerProgramGenre {
    readonly lv1: number;
    readonly lv2?: number;
    readonly un1?: number;
    readonly un2?: number;
}

/** 番組の映像方式情報。 */
export interface TunerProgramVideo {
    readonly type: string;
    readonly resolution: string;
    readonly streamContent: number;
    readonly componentType: number;
}

/** 番組の音声方式情報1系統分。多重音声の番組では`TunerProgram.audios`に複数件並ぶ。 */
export interface TunerProgramAudio {
    readonly componentType: number;
    readonly componentTag?: number;
    readonly isMain?: boolean;
    readonly samplingRate: number;
    readonly langs: string[];
}

/** シリーズ（連続番組）の情報。`expiresAt`はこのシリーズ判定情報自体の有効期限であり、番組の放送終了時刻ではない。 */
export interface TunerProgramSeries {
    readonly id: number;
    readonly repeat: number;
    readonly pattern: number;
    readonly expiresAt: number;
    readonly episode: number;
    readonly lastEpisode: number;
    readonly name: string;
}

/**
 * 現在の番組と関連する別の番組（同時ネットワーク放送や中継、番組移動先など）への参照。
 * `type`が省略される場合は「関連あり」以上の関係種別が不明であることを表す。
 */
export interface TunerProgramRelatedItem {
    readonly type?: 'shared' | 'relay' | 'movement';
    readonly networkId?: number;
    readonly serviceId: number;
    readonly eventId: number;
}

/** `TunerServerAccess`の各操作に共通して渡せるオプション。`signal`を渡すと呼び出し元都合でリクエストを中断できる。 */
export interface TunerRequestOptions {
    readonly signal?: AbortSignal;
}

/** 番組指定でのストリーム開始要求。`priority`はチューナーサーバーへ渡す視聴/録画優先度で、値が高いほど他の利用中チューナーを奪って確保しやすい。 */
export interface TunerProgramStreamRequest extends TunerRequestOptions {
    readonly programId: ProgramId;
    readonly priority: number;
}

/** サービス（チャンネル）指定でのストリーム開始要求。`priority`の意味は`TunerProgramStreamRequest`と同じ。 */
export interface TunerServiceStreamRequest extends TunerRequestOptions {
    readonly serviceId: TunerServerId;
    readonly priority: number;
}

/**
 * チューナーサーバーから取得したストリームの受け渡し口。
 * `stream`は生のTSデータを読み出すreadable stream、`close()`は視聴/録画を終了しチューナーの占有を解放する。
 * `close()`を呼ばずに`stream`を破棄すると、チューナーサーバー側の予約が解放されないままになり得る。
 */
export interface TunerStreamHandle {
    readonly stream: NodeJS.ReadableStream;
    close(): void;
}

/**
 * 検出されたチューナーサーバーの製品種別。両者はAPI形状・変更通知の配信方式が異なるため、
 * `TunerServerAccessModel`は`TunerProductDetector`でこれを判定してから経路を振り分ける。
 */
export type TunerServerProduct = 'mirakurun' | 'mirakc';

/**
 * 変更フィード（`TunerChangeAdapter.open`経由でチューナーサーバーから受信するpush通知）が表す変更内容の判別共用体。
 * - `program`操作は番組の新規作成/更新、削除、EPG再構成による識別子の再定義（`from`→`to`）を表す。
 *   `redefine`が起きるのはMirakurun側の実装に由来し、同一番組が別の`ProgramId`へ振り直されるケース。
 * - `service`操作はサービス（チャンネル）自体の作成/更新/削除。
 * - `service-programs-updated`と`on-air-service`はmirakc固有の通知（Mirakurunの変更フィードには現れない）。
 *   `service-programs-updated`は当該サービスのEPGが更新されたことのみを示し、変更後の番組内容自体は含まない
 *   （呼び出し側が必要なら別途取得し直す）。`on-air-service`は現在放送中番組の切り替わりを示す。
 */
export type TunerChange =
    | {
          readonly kind: 'program';
          readonly operation: 'create' | 'update';
          readonly program: TunerProgram;
          readonly time: number;
      }
    | { readonly kind: 'program'; readonly operation: 'remove'; readonly programId: ProgramId; readonly time: number }
    | {
          readonly kind: 'program';
          readonly operation: 'redefine';
          readonly from: ProgramId;
          readonly to: ProgramId;
          readonly time: number;
      }
    | {
          readonly kind: 'service';
          readonly operation: 'create' | 'update' | 'remove';
          readonly service: TunerService;
          readonly time: number;
      }
    | { readonly kind: 'service-programs-updated'; readonly serviceId: TunerServerId }
    | { readonly kind: 'on-air-service'; readonly serviceId: TunerServerId };

/**
 * 変更フィードの受信者が実装するcallback群。`TunerChangeAdapter.open`の呼び出し元が渡す。
 * `started()`は下位のstream/接続が確立できた時点で1回呼ばれる。`changed()`は通知1件ごと。
 * `aborted()`はfeedが異常終了したときに、`close`側のPromise reject前に呼ばれる。
 */
export interface TunerChangeObserver {
    started(): void;
    changed(change: TunerChange): void;
    aborted(error: Error): void;
}

/**
 * 開始済みの変更フィードの制御口。
 * `completion`はフィードが正常終了すると解決し、異常終了（エラー・切断）するとrejectするPromise。
 * `close()`を呼ぶと、エラー無しでfeedを終了させ`completion`を解決させる（`observer.aborted`は呼ばれない）。
 */
export interface TunerChangeFeedHandle {
    readonly completion: Promise<void>;
    close(): void;
}

/**
 * 接続先がMirakurunかmirakcかを判定する。判定結果は呼び出し元の実装（`ProductDetector`）でcacheされ得るため、
 * チューナーサーバーを起動し直さない限り同一インスタンスからの返答は変わらない前提で使う。
 */
export interface TunerProductDetector {
    detect(options?: TunerRequestOptions): Promise<TunerServerProduct>;
}

/**
 * 特定の製品（Mirakurun/mirakc）向けに変更フィードを開き、その独自の配信形式を`TunerChange`へ正規化する。
 * 実装は`change/MirakurunChangeAdapter.ts`・`change/MirakcChangeAdapter.ts`にあり、
 * それぞれの下位stream形式（Mirakurunの連結JSON、mirakcのServer-Sent Events）を解釈する。
 */
export interface TunerChangeAdapter {
    open(observer: TunerChangeObserver, options?: TunerRequestOptions): Promise<TunerChangeFeedHandle>;
}

/**
 * `TunerServerAccessModel.openChangeFeed`が製品判定と実際のfeed openを行うために必要な依存一式。
 * `detector`で製品を判定し、その結果に応じて`mirakurun`または`mirakc`のいずれかの`TunerChangeAdapter`を選ぶ。
 * この依存が設定されていない（未指定の）場合、`openChangeFeed`は変更フィード機能自体を提供しない。
 */
export interface TunerChangeFeedDependencies {
    readonly detector: TunerProductDetector;
    readonly mirakurun: TunerChangeAdapter;
    readonly mirakc: TunerChangeAdapter;
}

/**
 * チューナーサーバー（Mirakurun/mirakc）へのアクセス手段全体を表す契約。実装は`TunerServerAccessModel`。
 * 各methodの`options`は共通して省略可能で、省略時は既定のtimeoutのみが適用され中断はできない。
 */
export interface TunerServerAccess {
    /** チューナーサーバーへ疎通確認のみ行う。到達できない場合は例外を投げる。 */
    checkAvailability(): Promise<void>;
    /**
     * チューナーサーバーの稼働状態とversion情報を取得する。
     * @param options 中断用の`signal`等の共通オプション。
     * @returns 疎通済みであることを表す状態（`available: true`固定）とversion文字列。
     */
    getStatus(options?: TunerRequestOptions): Promise<TunerServerStatus>;
    /**
     * チューナーサーバーが持つチューナー一覧を取得する。
     * @param options 中断用の`signal`等の共通オプション。
     * @returns 検出された全チューナーの状態一覧。
     */
    getTuners(options?: TunerRequestOptions): Promise<TunerInfo[]>;
    /**
     * チューナーサーバーが把握している放送サービス（チャンネル）一覧を取得する。
     * @param options 中断用の`signal`等の共通オプション。
     * @returns 放送サービス一覧。
     */
    getServices(options?: TunerRequestOptions): Promise<TunerService[]>;
    /**
     * チューナーサーバーが保持するEPG番組一覧を全件取得する。
     * @param options 中断用の`signal`等の共通オプション。
     * @returns 番組一覧。
     */
    getPrograms(options?: TunerRequestOptions): Promise<TunerProgram[]>;
    /**
     * 指定した放送サービスに紐づく番組一覧を取得する。
     * @param serviceId 対象の放送サービスID。
     * @param options 中断用の`signal`等の共通オプション。
     * @returns 当該サービスの番組一覧。
     */
    getProgramsByService(serviceId: TunerServerId, options?: TunerRequestOptions): Promise<TunerProgram[]>;
    /**
     * 番組IDを指定して単一の番組情報を取得する。
     * @param programId 対象の番組ID。
     * @param options 中断用の`signal`等の共通オプション。
     * @returns 該当番組の情報。存在しない場合は例外を投げる。
     */
    getProgram(programId: ProgramId, options?: TunerRequestOptions): Promise<TunerProgram>;
    /**
     * 放送サービスのロゴ画像を取得する。
     * @param serviceId 対象の放送サービスID。
     * @param options 中断用の`signal`等の共通オプション。
     * @returns ロゴ画像のバイナリ本体。
     */
    getLogo(serviceId: TunerServerId, options?: TunerRequestOptions): Promise<Buffer>;
    /**
     * 指定した番組の視聴/録画用ストリームを開く。
     * @param request 対象番組ID・優先度・中断用`signal`をまとめた要求。
     * @returns 開いたストリームの受け渡し口。使い終えたら`close()`で解放すること。
     */
    openProgramStream(request: TunerProgramStreamRequest): Promise<TunerStreamHandle>;
    /**
     * 指定した放送サービスの視聴/録画用ストリームを開く。
     * @param request 対象サービスID・優先度・中断用`signal`をまとめた要求。
     * @returns 開いたストリームの受け渡し口。使い終えたら`close()`で解放すること。
     */
    openServiceStream(request: TunerServiceStreamRequest): Promise<TunerStreamHandle>;
    /**
     * 番組/サービスの変更を通知する変更フィードを開く。裏で製品種別を判定し、対応するアダプターへ委譲する
     * （`TunerChangeFeedDependencies`が設定されていない構成では利用できず例外を投げる）。
     * @param observer 変更通知を受け取るcallback群。
     * @param options 中断用の`signal`等の共通オプション。
     * @returns 開いた変更フィードの制御口。
     */
    openChangeFeed(observer: TunerChangeObserver, options?: TunerRequestOptions): Promise<TunerChangeFeedHandle>;
}
