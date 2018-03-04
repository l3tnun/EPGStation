import * as fs from 'fs';

/**
 * file 周りの Util
 */
namespace FileUtil {
    /**
     * ファイルサイズ取得
     * @param filePath: string
     * @return number
     * @throws FileIsNotFound
     */
    export const getFileSize = (filePath: string): number => {
        try {
            const stat = fs.statSync(filePath);

            return stat.size;
        } catch (err) {
            throw new Error('FileIsNotFound');
        }
    };
}

export default FileUtil;

