namespace DBUtil {
    /**
     * and query 作成
     * @param strs: string[]
     * @return string
     */
    export const createAndQuery = (strs: string[]): string => {
        if (strs.length === 0) {
            return '';
        }

        let str = '';
        for (let i = 0; i < strs.length; i++) {
            str += i === strs.length - 1 ? `(${strs[i]})` : `(${strs[i]}) and `;
        }

        return `(${str})`;
    };

    /**
     * or query 作成
     * @param strs: string[]
     * @return string
     */
    export const createOrQuery = (strs: string[]): string => {
        let str = '';
        for (let i = 0; i < strs.length; i++) {
            str += i === strs.length - 1 ? `(${strs[i]})` : `(${strs[i]}) or`;
        }

        return `(${str})`;
    };

    /** 件数の上限がないものとして扱う limit 0 で、offset を併用するときに `take` へ渡す値（MySQL は上限なしの offset を拒むため）。 */
    export const UNLIMITED_TAKE = 2147483647;

    /**
     * 一覧の offset・limit を、query builder の `skip`・`take` へ渡す値へ変換する。
     * limit 0 は件数の制限なしを表す（TypeORM 1.x は `take(0)` を `LIMIT 0` にするため、`take` を付けない）。
     * limit 0 に offset 1 以上が付くときは、上限なしの offset を拒む MySQL でも通るよう十分大きな `take` を与える。
     * @param option offset・limit
     * @return 適用する skip・take（未定義の項目は適用しない）
     */
    export const resolvePagination = (option: {
        offset?: number;
        limit?: number;
    }): { skip: number | undefined; take: number | undefined } => {
        if (option.limit !== 0) {
            return { skip: option.offset, take: option.limit };
        }

        return option.offset === undefined || option.offset === 0
            ? { skip: undefined, take: undefined }
            : { skip: option.offset, take: UNLIMITED_TAKE };
    };
}

export default DBUtil;
