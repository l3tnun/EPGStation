/// <reference path="./fs-extra.d.ts" />

import * as fs from 'fs';
import * as fse from 'fs-extra';
import * as path from 'path';

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

    /**
     * FileList 定義
     */
    export interface FileList {
        files: string[];
        directories: string[];
    }

    /**
     * 指定したディレクトリ以下の file と directory 一覧を返す
     * @return Promise<FileUtil.FileList>
     */
    export const getFileList = (fileDir: string): Promise<FileUtil.FileList> => {
        return new Promise<FileUtil.FileList>((resolve: (result: FileList) => void, reject: (err: Error) => void) => {
            fs.readdir(fileDir, async(err, files) => {
                if (err) {
                    reject(err);
                } else {
                    const results: FileList = {
                        files: [],
                        directories: [],
                    };
                    for (const file of files) {
                        // 隠しディレクトリはスキップ
                        if (file.slice(0, 1) === '.') { continue; }

                        // get full path
                        const filePath = path.join(fileDir, file);

                        if (fs.statSync(filePath).isDirectory()) {
                            results.directories.push(filePath);
                            try {
                                // sub directory 探索
                                const subFiles = await FileUtil.getFileList(filePath);
                                Array.prototype.push.apply(results.files, subFiles.files);
                                Array.prototype.push.apply(results.directories, subFiles.directories);
                            } catch (err) {
                            }
                        } else {
                            results.files.push(filePath);
                        }
                    }

                    resolve(results);
                }
            });
        });
    };

    /**
     * directory が空か
     * @param dir: string
     * @return Promise<boolean>
     */
    export const isEmptyDirectory = (dir: string): Promise<boolean> => {
        return new Promise<boolean>((resolve: (result: boolean) => void, reject: (err: Error) => void) => {
            fs.readdir(dir, (err, files) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(files.length === 0);
                }
            });
        });
    };

    /**
     * ディレクトリを削除
     * @param dir: string
     * @return Promise<void>
     */
    export const promiseRmdir = (dir: string): Promise<void> => {
        return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
            fs.rmdir(dir, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    };

    /**
     * ファイル存在確認
     * @param file: string
     * @return Promise<boolean>
     */
    export const checkFile = (file: string): Promise<boolean> => {
        return new Promise<boolean>((resolve: (result: boolean) => void) => {
            fs.stat(file, (err) => {
                if (err) {
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
    };

    /**
     * touch file
     * @param file: string
     * @return Promise<void>
     */
    export const touchFile = (file: string): Promise<void> => {
        return new Promise<void>((resolve: () => void, reject: (error: Error) => void) => {
            fs.writeFile(file, '', (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    };
}

export default FileUtil;

