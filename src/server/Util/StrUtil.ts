import * as Enums from '../Enums';

/**
 * 文字周りの Util
 */
namespace StrUtil {
    /**
     * 文字列をデータベース用文字列に変換する．
     *
     * convertDBStrの値によって以下のように文字列の変換を行う
     *    - 'no': PostgreSQL非対応文字の削除
     *    - 'twoByte': PostgreSQL非対応文字の削除，半角英数記号を全角に変換
     *    - else: PostgreSQL非対応文字の削除，全角英数記号を半角に変換
     * @param str: string
     * @param convertDBStr: string
     * @return string
     */
    export const toDBStr = (str: string, convertDBStr: Enums.ConvertStrType): string => {
      const ret = convertDBStr === 'no' ? str : convertDBStr === 'twoByte' ? toDouble(str) : toHalf(str);

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
     * 半角英数記号を全角へ変換する
     * @param str: string
     * @return string
     */
    export const toDouble = (str: string): string => {
        const tmp = str.replace(/\\/g, '￥').replace(/[!-~]/g, (s) => {
            return String.fromCharCode(s.charCodeAt(0) + 0xFEE0);
        });

        return tmp.replace(/"/g, '”')
            .replace(/\'/g, '’')
            .replace(/`/g, '‘')
            // tslint:disable-next-line:no-irregular-whitespace
            .replace(/ /g, '　')
            .replace(/~/g, '〜')
            .replace(/［/g, '[')
            .replace(/］/g, ']');
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

