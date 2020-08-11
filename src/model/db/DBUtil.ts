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
}

export default DBUtil;
