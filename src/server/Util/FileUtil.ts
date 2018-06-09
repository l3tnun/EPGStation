/// <reference path="./fs-extra.d.ts" />

import * as fs from 'fs';
import * as fse from 'fs-extra';

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
            fs.rename(oldPath, newPath, async(err) => {
                if (err) {
                    await FileUtil.promiseUnlink(newPath)
                    .catch(() => {});

                    reject(err);
                } else {
                    reslove();
                }
            });
        });
    };

    /**
     * Promise file copy and delete
     * @param oldPath: old file path
     * @param newPath: new file path
     * @return Promise<void>
     */
    export const promiseMove = async(oldPath: string, newPath: string): Promise<void> => {
        // copy
        try {
            await fse.copy(oldPath, newPath);
        } catch (err) {
            await FileUtil.promiseUnlink(newPath)
            .catch(() => {});

            throw err;
        }

        // delete old file
        await FileUtil.promiseUnlink(oldPath);
    };
}

export default FileUtil;

