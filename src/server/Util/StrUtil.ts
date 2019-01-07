/**
 * 文字周りの Util
 */
namespace StrUtil {
    /**
     * 文字列をデータベース用文字列に変換する．
     * convertTwoByteToOneByteがundefinedあるいはtrueの場合は全角英数記号を半角へ変換する
     * @param str: string
     * @param convertTwoByteToOneByte: boolean
     * @return string
     */
    export const toDBStr = (str: string, convertTwoByteToOneByte: boolean | undefined): string => {
      const convertCond = convertTwoByteToOneByte === undefined ? true : convertTwoByteToOneByte;
      const ret = convertCond ? toHalf(str) : str;

      return ret.replace(/\x00/g, ''); // PostgreSQL 非対応文字
    };

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
            .replace(/〜/g, '~');
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

