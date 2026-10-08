const preparedDeletionTokenBrand: unique symbol = Symbol('PreparedDeletionToken');

/**
 * `prepare`が発行するtoken。中身を持たないbrand型で、`prepare`を経由せず直接値を作ることはできない
 * （`IPreparedRecordedDeletionProvider`等のprepare/commit二段構えの各実装で、tokenの実体を
 * このregistry内に閉じ込めるための型的な強制）。
 */
export interface PreparedDeletionToken {
    readonly [preparedDeletionTokenBrand]: never;
}

/**
 * `consume`の結果。
 * - `consumed`: 有効なtokenで、対応する値を1回だけ取り出せた（以後同じtokenは`token-replayed`になる）。
 * - `token-replayed`: 既に`consume`済みのtokenが再度渡された（IPC再送等による二重実行を検知させるため）。
 * - `token-stale`: 未知のtoken、または`kind`が異なるため対応する登録が見つからない。
 */
export type PreparedDeletionTokenConsumption<T> =
    | { readonly type: 'consumed'; readonly value: T }
    | { readonly type: 'token-replayed' }
    | { readonly type: 'token-stale' };

interface KindRegistry<T> {
    readonly active: WeakMap<PreparedDeletionToken, T>;
    readonly consumed: WeakSet<PreparedDeletionToken>;
}

/**
 * 削除処理のprepare（検証してtoken発行）とcommit（tokenを消費して実削除）を仲介する汎用registry。
 * `kind`（用途ごとの名前空間、例: 録画削除用・ビデオファイル削除用）ごとに独立したtoken集合を持ち、
 * 異なる`kind`のtokenが誤って consume されないようにする。`T`はtokenに紐づけて保持する値の型
 * （例: 削除対象のrecordedId）。
 */
export default class PreparedDeletionTokenRegistry<T, K extends string = string> {
    /** `kind`ごとの、有効なtokenの集合（`active`）と消費済みtokenの集合（`consumed`）。 */
    private readonly registries = new Map<K, KindRegistry<T>>();

    /**
     * 新しいtokenを発行し、`value`と紐づけて`active`集合へ登録する。
     * @param kind このtokenが属する名前空間。
     * @param value tokenに紐づける値（`consume`成功時に返される）。
     * @returns 新規に発行されたtoken。
     */
    public prepare(kind: K, value: T): PreparedDeletionToken {
        const token = Object.freeze(Object.create(null)) as PreparedDeletionToken;
        this.getOrCreateRegistry(kind).active.set(token, value);
        return token;
    }

    /**
     * tokenを1回だけ消費し、紐づけられていた値を取り出す。
     * @param kind tokenが属する名前空間（`prepare`時に渡したものと一致する必要がある）。
     * @param token `prepare`が発行したtoken。
     * @returns 消費結果。有効なら`consumed`、既に消費済みなら`token-replayed`、
     *          未知またはkind不一致なら`token-stale`。
     */
    public consume(kind: K, token: PreparedDeletionToken): PreparedDeletionTokenConsumption<T> {
        const registry = this.registries.get(kind);
        if (typeof registry === 'undefined') {
            return { type: 'token-stale' };
        }
        if (registry.active.has(token)) {
            const value = registry.active.get(token) as T;
            registry.active.delete(token);
            registry.consumed.add(token);
            return { type: 'consumed', value };
        }
        if (registry.consumed.has(token)) {
            return { type: 'token-replayed' };
        }
        return { type: 'token-stale' };
    }

    /**
     * `kind`に対応する`KindRegistry`を返す。存在しなければ空のものを新規作成して登録する。
     * @param kind 対象の名前空間。
     * @returns 対応する（既存または新規作成した）`KindRegistry`。
     */
    private getOrCreateRegistry(kind: K): KindRegistry<T> {
        const existing = this.registries.get(kind);
        if (typeof existing !== 'undefined') {
            return existing;
        }
        const registry: KindRegistry<T> = {
            active: new WeakMap(),
            consumed: new WeakSet(),
        };
        this.registries.set(kind, registry);
        return registry;
    }
}
