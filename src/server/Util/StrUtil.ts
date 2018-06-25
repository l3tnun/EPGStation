/**
 * 文字周りの Util
 */
namespace StrUtil {
    /**
     * 全角英数記号を半角へ変換する
     * @param str: string
     * @return string
     */
    export const toHalf = (str: string): string => {
        const tmp = str.replace(/[！-～]/g, (s) => {
            return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
        });

        return tmp.replace(/”/g, '"')
            .replace(/’/g, '\'')
            .replace(/‘/g, '`')
            .replace(/￥/g, '\\')
            // tslint:disable-next-line:no-irregular-whitespace
            .replace(/　/g, ' ')
            .replace(/〜/g, '~')
            .replace(/\x00/g, ''); // PostgreSQL 非対応文字
    };

    /**
     * [] を中身ごと削除し 先頭と末尾のスペースを削除する
     * @param str: string
     * @return string
     */
    export const deleteBrackets = (str: string): string => {
        return str.replace(/\[.+?\]/g, '').trim();
    };
}

export default StrUtil;

