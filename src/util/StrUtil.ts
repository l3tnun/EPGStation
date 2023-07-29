// import * as Enums from '../Enums';

/**
 * 文字周りの Util
 */
namespace StrUtil {
    /**
     * 番組表で使用される囲み文字
     */
    const enclosedCharactersConvertTable: { [key: string]: string } = {
        '\u{1f14a}': '[HV]',
        '\u{1f13f}': '[P]',
        '\u{1f14c}': '[SD]',
        '\u{1f146}': '[W]',
        '\u{1f14b}': '[MV]',
        '\u{1f210}': '[手]',
        '\u{1f211}': '[字]',
        '\u{1f212}': '[双]',
        '\u{1f213}': '[デ]',
        '\u{1f142}': '[S]',
        '\u{1f214}': '[二]',
        '\u{1f215}': '[多]',
        '\u{1f216}': '[解]',
        '\u{1f14d}': '[SS]',
        '\u{1f131}': '[B]',
        '\u{1f13d}': '[N]',
        '\u{1f217}': '[天]',
        '\u{1f218}': '[交]',
        '\u{1f219}': '[映]',
        '\u{1f21a}': '[無]',
        '\u{1f21b}': '[料]',
        '\u{26bf}': '[鍵]',
        '\u{1f21c}': '[前]',
        '\u{1f21d}': '[後]',
        '\u{1f21e}': '[再]',
        '\u{1f21f}': '[新]',
        '\u{1f220}': '[初]',
        '\u{1f221}': '[終]',
        '\u{1f222}': '[生]',
        '\u{1f223}': '[販]',
        '\u{1f224}': '[声]',
        '\u{1f225}': '[吹]',
        '\u{1f14e}': '[PPV]',
        '\u{3299}': '[秘]',
        '\u{1f200}': '[ほか]',
    };

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
     * [] でくくられた文字と囲み文字を削除し 先頭と末尾のスペースを削除する
     * @param str: string
     * @return string
     */
    export const deleteBrackets = (str: string): string => {
        // 囲み文字を削除
        for (const key in enclosedCharactersConvertTable) {
            str = str.replaceAll(key, '');
        }

        // [] でくくられた文字を削除 + 先頭と末尾のスペースを削除する
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

    /**
     * 囲み文字を [] でくくった文字に置き換える
     * @param str
     * @returns
     */
    export const replaceEnclosedCharacters = (str: string): string => {
        for (const key in enclosedCharactersConvertTable) {
            str = str.replaceAll(key, enclosedCharactersConvertTable[key]);
        }

        return str;
    };
}

export default StrUtil;
