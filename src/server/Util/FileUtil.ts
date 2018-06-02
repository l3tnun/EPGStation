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

    /**
     * Promise Unlink
     * @param filePath: file path
     */
    export const promiseUnlink = (filePath: string): Promise<void> => {
        return new Promise<void>((reslove: () => void, reject: (error: Error) => void) => {
            fs.unlink(filePath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    reslove();
                }
            });
        });
    };

    /**
     * Promise file rename
     * @param oldPath: old file path
     * @param newPath: new file path
     * @return Promise<void>
     */
    export const promiseRename = (oldPath: string, newPath: string): Promise<void> => {
        return new Promise<void>((reslove: () => void, reject: (error: Error) => void) => {
            fs.rename(oldPath, newPath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    reslove();
                }
            });
        });
    };
}

export default FileUtil;

