/**
 * IPTV向けドキュメント生成が、生成処理の途中でリクエストがまだ有効かを確認するための契約。
 * `IptvDocumentRequestGuard`（`completeIptvDocumentRequest`）が実装を渡し、応答がclose済み・
 * 生成に時間をかけすぎた場合は`ensureActive`が例外を投げて処理を打ち切らせる。
 */
export interface IptvRequestContext {
    ensureActive(): void;
}

/** チャンネル一覧（m3u8）生成時に、チャンネルロゴ・ライブ配信のURLを呼び出し側の事情（host、サブディレクトリ等）に応じて組み立てるための関数群。 */
export interface IptvPublicUrlBuilder {
    readonly channelLogoUrl: (channelId: number) => string;
    readonly liveM2tsUrl: (channelId: number, mode: number) => string;
}

/** `getChannelList`の入力。 */
export interface IptvChannelListInput {
    readonly isHalfWidth: boolean;
    readonly mode: number;
    readonly publicUrls: IptvPublicUrlBuilder;
}

/** IPTV連携（m3u8チャンネル一覧・XMLTV番組表）を生成するAPI層の契約。実装は`IPTVApiModel`。 */
export default interface IIPTVApiModel {
    /**
     * IPTV再生機器向けのm3u8チャンネル一覧を生成する。
     * @param input 半角/全角指定、ストリーミングmode、URL組み立て関数群。
     * @returns m3u8形式のチャンネル一覧文字列。
     */
    getChannelList(input: IptvChannelListInput): Promise<string>;
    /**
     * XMLTV形式の番組表を生成する。
     * @param days 現在時刻から何日分の番組を含めるか。
     * @param isHalfWidth 番組名・番組詳細を半角文字で返すか。
     * @returns XMLTV形式の番組表文字列。
     */
    getEpg(days: number, isHalfWidth: boolean): Promise<string>;
    /**
     * `getEpg`と同じ処理を行うが、生成途中で`requestContext.ensureActive()`により
     * リクエストの有効性を確認する（HTTPリクエストがタイムアウト・切断された場合に生成を打ち切るため）。
     * 実装が無い場合は呼び出し側が`getEpg`にフォールバックする、任意実装のmethod。
     * @param days 現在時刻から何日分の番組を含めるか。
     * @param isHalfWidth 番組名・番組詳細を半角文字で返すか。
     * @param requestContext 生成処理の継続可否を確認するための context。
     * @returns XMLTV形式の番組表文字列。
     */
    getEpgForRequest?(days: number, isHalfWidth: boolean, requestContext: IptvRequestContext): Promise<string>;
}
