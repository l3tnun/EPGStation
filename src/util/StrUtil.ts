// import * as Enums from '../Enums';

/**
 * 文字周りの Util
 */
namespace StrUtil {
    /**
     * 文字列をデータベース用文字列に変換する．
     * PostgreSQL非対応文字の削除
     * @param str: string
     * @return string
     */
    export const toDBStr = (str: string): string => {
        // eslint-disable-next-line no-control-regex
        return str.replace(/\x00/g, ''); // PostgreSQL 非対応文字
    };

    /**
     * 全角英数記号を半角へ変換する
     * @param str: string
     * @return string
     */
    export const toHalf = (str: string): string => {
        const tmp = str.replace(/[！-～]/g, s => {
            return String.fromCharCode(s.charCodeAt(0) - 0xfee0);
        });

        return (
            tmp
                .replace(/”/g, '"')
                .replace(/’/g, "'")
                .replace(/‘/g, '`')
                .replace(/￥/g, '\\')
                // eslint-disable-next-line no-irregular-whitespace
                .replace(/　/g, ' ')
                .replace(/〜/g, '~')
        );
    };

    /**
     * 半角英数記号を全角へ変換する
     * @param str: string
     * @return string
     */
    export const toDouble = (str: string): string => {
        const tmp = str.replace(/\\/g, '￥').replace(/[!-~]/g, s => {
            return String.fromCharCode(s.charCodeAt(0) + 0xfee0);
        });

        return tmp
            .replace(/"/g, '”')
            .replace(/\'/g, '’')
            .replace(/`/g, '‘')
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

    /**
     * windows のディレクトリ名での禁止文字列を置換
     * @param str: 文字列
     * @return string
     */
    export const replaceDirName = (str: string): string => {
        return str
            .replace(/\:/g, '：')
            .replace(/\*/g, '＊')
            .replace(/\?/g, '？')
            .replace(/\"/g, '”')
            .replace(/\</g, '＜')
            .replace(/\>/g, '＞')
            .replace(/\|/g, '｜')
            .replace(/\./g, '．');
    };

    /**
     * windows のファイル名での禁止文字列を置換
     * @param str: 文字列
     * @return string
     */
    export const replaceFileName = (str: string): string => {
        return StrUtil.replaceDirName(str).replace(/\//g, '／').replace(/\\/g, '￥').replace(/\¥/g, '￥');
    };
}

export default StrUtil;
