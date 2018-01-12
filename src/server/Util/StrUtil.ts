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
        let tmp = str.replace(/[！-～]/g, (s) => {
            return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
        });

        return tmp.replace(/”/g, '"')
            .replace(/’/g, '\'')
            .replace(/‘/g, '`')
            .replace(/￥/g, '\\')
            .replace(/　/g, ' ')
            .replace(/〜/g, '~')
            .replace(/\x00/g, ''); // PostgreSQL 非対応文字
    }
}

export default StrUtil;

