/**
 * 文字周りの Util
 */
namespace StrUtil {
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

