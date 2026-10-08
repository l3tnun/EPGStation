/**
 * resourceId（既定では録画ID）単位で、非同期処理を1件ずつ直列実行させるための排他lock。
 * 同一idに対する`runExclusive`呼び出しはPromise chainで数珠つなぎになり、先行する処理が
 * 完了するまで後続は待たされる。異なるidどうしは互いに待たない。
 */
export default class RecordedResourceMutationLock<K = number> {
    /** resourceIdごとの「直前に予約された処理の完了」を表すPromiseの末尾（tail）。
     *  未登録のidは何も実行中でないことを意味し、実行完了後に自分がまだ末尾なら削除して回収する。 */
    private readonly tails = new Map<K, Promise<void>>();

    /**
     * 指定resourceIdについて、先行する`runExclusive`呼び出しの完了を待ってから`operation`を実行する。
     * @param resourceId 排他制御の単位となる識別子。
     * @param operation 排他区間内で実行する処理。
     * @returns `operation`の戻り値。
     */
    public async runExclusive<T>(resourceId: K, operation: () => T | Promise<T>): Promise<T> {
        const predecessor = this.tails.get(resourceId) ?? Promise.resolve();
        let release!: () => void;
        const tail = new Promise<void>(resolve => {
            release = resolve;
        });
        this.tails.set(resourceId, tail);

        await predecessor;
        try {
            return await operation();
        } finally {
            release();
            if (this.tails.get(resourceId) === tail) {
                this.tails.delete(resourceId);
            }
        }
    }
}
