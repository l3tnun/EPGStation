import * as fs from 'fs';
import mkdirp from 'mkdirp';

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
}

export default FileUtil;
