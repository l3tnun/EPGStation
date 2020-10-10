import * as fs from 'fs';
import mkdirp from 'mkdirp';
import * as path from 'path';

namespace FileUtil {
    /**
     * unlink
     * @param filePath: file path
     */
    export const unlink = (filePath: string): Promise<void> => {
        return new Promise<void>((reslove: () => void, reject: (error: Error) => void) => {
            fs.unlink(filePath, err => {
                if (err) {
                    reject(err);
                } else {
                    reslove();
                }
            });
        });
    };

    /**
     * access
     * @param filePath: file path
     * @param mode: mode
     */
    export const access = (filePath: string, mode: number | undefined): Promise<void> => {
        return new Promise<void>((reslove: () => void, reject: (error: Error) => void) => {
            fs.access(filePath, mode, err => {
                if (err) {
                    reject(err);
                } else {
                    reslove();
                }
            });
        });
    };

    /**
     * mkdir
     * @param dirPath: dir path
     */
    export const mkdir = async (dirPath: string): Promise<void> => {
        await mkdirp(dirPath);
    };

    /**
     * stat
     * @param filePath: file path
     * @return Promise<fs.Stats>
     */
    export const stat = (filePath: string): Promise<fs.Stats> => {
        return new Promise<fs.Stats>((reslove: (result: fs.Stats) => void, reject: (error: Error) => void) => {
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    reject(err);
                } else {
                    reslove(stats);
                }
            });
        });
    };

    /**
     * ファイルサイズ取得
     * @param filePath: string
     * @return Promise<number?
     * @throws FileIsNotFound
     */
    export const getFileSize = async (filePath: string): Promise<number> => {
        try {
            return (await FileUtil.stat(filePath)).size;
        } catch (err) {
            throw new Error('FileIsNotFound');
        }
    };

    /**
     * 指定されたディレクトのファイル一覧を返す
     * @param dirPath: string ディレクトパス
     * @return Promise<string[]> ファイル一覧
     */
    export const readDir = async (dirPath: string): Promise<string[]> => {
        return new Promise((resolve, reject) => {
            fs.readdir(dirPath, (err, files) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(files);
                }
            });
        });
    };

    /**
     * 指定したファイルを一括で読み取る
     * @param filePath: string
     * @return Promise<string>
     */
    export const readFile = async (filePath: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            fs.readFile(filePath, 'utf-8', (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    };

    /**
     * 指定したファイルに書き込む (新規作成 or 上書き)
     * @param filePath: string
     * @param data: string
     * @return Promise<void>
     */
    export const writeFile = async (filePath: string, data: string): Promise<void> => {
        return new Promise((resolve, reject) => {
            fs.writeFile(filePath, data, err => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    };

    /**
     * Promise file rename
     * @param src: source file path
     * @param dest: dest file path
     * @return Promise<void>
     */
    export const rename = (src: string, dest: string): Promise<void> => {
        return new Promise<void>((reslove, reject) => {
            fs.rename(src, dest, async err => {
                if (err) {
                    await FileUtil.unlink(dest).catch(() => {});

                    reject(err);
                } else {
                    reslove();
                }
            });
        });
    };

    /**
     * Promise file copy
     * @param src: source file path
     * @param dest: dest file path
     * @return Promise<void>
     */
    export const copyFile = (src: string, dest: string): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
            fs.copyFile(src, dest, err => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    };

    /**
     * Promise file copy and delete
     * @param src: source file path
     * @param dest: dest file path
     * @return Promise<void>
     */
    export const move = async (src: string, dest: string): Promise<void> => {
        try {
            await FileUtil.copyFile(src, dest);
        } catch (err) {
            await FileUtil.unlink(dest).catch(() => {});

            throw err;
        }

        // delete old file
        await FileUtil.unlink(src);
    };

    /**
     * touch file
     * @param file: string
     * @return Promise<void>
     */
    export const touchFile = (file: string): Promise<void> => {
        return new Promise<void>((resolve: () => void, reject: (error: Error) => void) => {
            fs.writeFile(file, '', err => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    };

    /**
     * 指定したファイルに追加
     * @param file: string file path
     * @param str: string 追記内容
     * @return Promise<void>
     */
    export const appendFile = (file: string, str: string): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
            fs.appendFile(file, str, err => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
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
            fs.readdir(fileDir, async (err, files) => {
                if (err) {
                    reject(err);
                } else {
                    const results: FileList = {
                        files: [],
                        directories: [],
                    };
                    for (const file of files) {
                        // 隠しディレクトリはスキップ
                        if (file.slice(0, 1) === '.') {
                            continue;
                        }

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
                                // error
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
        return new Promise<boolean>((resolve, reject) => {
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
    export const rmdir = (dir: string): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
            fs.rmdir(dir, err => {
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
