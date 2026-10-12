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

    /** 件数の上限がないものとして扱うとき (limit 0 または limit の省略) に、offset を併用すると `take` へ渡す値（MySQL は上限なしの offset を拒むため）。 */
    export const UNLIMITED_TAKE = 2147483647;

    /**
     * 一覧の offset・limit を、query builder の `skip`・`take` へ渡す値へ変換する。
     * limit 0 は件数の制限なしを表す（TypeORM 1.x は `take(0)` を `LIMIT 0` にするため、`take` を付けない）。
     * 件数の制限なし (limit 0 または limit の省略) に offset が付くときは、上限なしの offset を拒む MySQL でも通るよう
     * 十分大きな `take` を与える。limit 0 に付く offset 0 は何も適用しない。
     * @param option offset・limit
     * @return 適用する skip・take（未定義の項目は適用しない）
     */
    export const resolvePagination = (option: {
        offset?: number;
        limit?: number;
    }): { skip: number | undefined; take: number | undefined } => {
        if (option.limit !== 0 && option.limit !== undefined) {
            return { skip: option.offset, take: option.limit };
        }

        if (option.offset === undefined || (option.limit === 0 && option.offset === 0)) {
            return { skip: undefined, take: undefined };
        }

        return { skip: option.offset, take: UNLIMITED_TAKE };
    };
}

export default DBUtil;
