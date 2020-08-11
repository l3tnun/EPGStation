namespace StrUtil {
    /**
     * 番組名から検索用の文字列を生成する
     * @param name: string 番組名
     * @return string
     */
    export const createSearchKeyword = (name: string): string => {
        const outTitle = name
            .replace(/\[.+?\]/g, ' ')
            .replace(/\【.+?\】/g, ' ')
            .replace(/\(.\)/g, ' ')
            .replace(/ +/g, ' ')
            .trim();
        let delimiter = ' #';
        if (outTitle.indexOf(' #') === -1) {
            delimiter = outTitle.indexOf('「') === -1 ? '' : '「';
        }

        let keyword: string[] = [];
        if (delimiter.length > 0) {
            keyword = outTitle.split(delimiter);
        }
        if (typeof keyword[0] === 'undefined' || keyword[0].length === 0 || keyword[0] === '') {
            keyword[0] = outTitle;
        }

        return keyword[0];
    };
}

export default StrUtil;
