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
}

export default FileUtil;
