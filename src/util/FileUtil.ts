import * as fs from 'fs';
import { mkdirp } from 'mkdirp';
import * as path from 'path';

/**
 * `fs` の代表的なファイル操作を Promise 化した薄いラッパー関数群。加えて、削除操作の安全側
 * チェック（`captureManagedRootIdentity`/`isManagedEntrySafeForRemoval`、管理対象ルート配下か
 * どうかの確認）もここに置かれている。
 */
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
        } catch (err: any) {
            throw new Error('FileIsNotFound', { cause: err });
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
        } catch (err: any) {
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

    const emptyFileList = (): FileList => ({
        files: [],
        directories: [],
    });

    interface ManagedFileListResult extends FileList {
        enumerationSucceeded: boolean;
    }

    export interface ManagedRootIdentity {
        readonly entryDevice: number;
        readonly entryInode: number;
        readonly entryIsSymbolicLink: boolean;
        readonly targetDevice: number;
        readonly targetInode: number;
    }

    export const captureManagedRootIdentity = (managedRoot: string): ManagedRootIdentity => {
        const resolvedRoot = path.resolve(managedRoot);
        const entryStats = fs.lstatSync(resolvedRoot);
        const targetStats = fs.statSync(resolvedRoot);
        if (targetStats.isDirectory() === false) throw new Error('ManagedRootIsNotDirectory');
        return {
            entryDevice: entryStats.dev,
            entryInode: entryStats.ino,
            entryIsSymbolicLink: entryStats.isSymbolicLink(),
            targetDevice: targetStats.dev,
            targetInode: targetStats.ino,
        };
    };

    const isSameManagedRoot = (managedRoot: string, expected: ManagedRootIdentity): boolean => {
        const current = captureManagedRootIdentity(managedRoot);
        return (
            current.entryDevice === expected.entryDevice &&
            current.entryInode === expected.entryInode &&
            current.entryIsSymbolicLink === expected.entryIsSymbolicLink &&
            current.targetDevice === expected.targetDevice &&
            current.targetInode === expected.targetInode
        );
    };

    export const isManagedEntrySafeForRemoval = (
        managedRoot: string,
        entryPath: string,
        expectedRoot: ManagedRootIdentity,
        expectedDirectory: boolean = false,
    ): boolean => {
        const resolvedRoot = path.resolve(managedRoot);
        const resolvedEntry = path.resolve(entryPath);
        const relativePath = path.relative(resolvedRoot, resolvedEntry);
        if (
            relativePath.length === 0 ||
            relativePath === '..' ||
            relativePath.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativePath)
        ) {
            return false;
        }

        const segments = relativePath.split(path.sep);
        let parentPath = resolvedRoot;
        try {
            if (isSameManagedRoot(resolvedRoot, expectedRoot) === false) return false;
            for (const segment of segments.slice(0, -1)) {
                parentPath = path.join(parentPath, segment);
                const parentStats = fs.lstatSync(parentPath);
                if (parentStats.isSymbolicLink() || parentStats.isDirectory() === false) return false;
            }
            if (expectedDirectory) {
                const entryStats = fs.lstatSync(resolvedEntry);
                return entryStats.isSymbolicLink() === false && entryStats.isDirectory();
            }
        } catch {
            return false;
        }
        return true;
    };

    const emptyManagedFileListResult = (enumerationSucceeded: boolean): ManagedFileListResult => ({
        ...emptyFileList(),
        enumerationSucceeded,
    });

    const readFileListDirectory = (directoryPath: string): Promise<string[]> => {
        return new Promise<string[]>((resolve, reject) => {
            try {
                fs.readdir(directoryPath, (err, files) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(files);
                    }
                });
            } catch (error: unknown) {
                reject(error);
            }
        });
    };

    const isManagedEntry = (managedRoot: string, entryPath: string): boolean => {
        const relativePath = path.relative(managedRoot, entryPath);
        return (
            relativePath.length > 0 &&
            relativePath !== '..' &&
            relativePath.startsWith(`..${path.sep}`) === false &&
            path.isAbsolute(relativePath) === false
        );
    };

    const recordFileListFailure = (message: string, failedPath: string, error: unknown): void => {
        console.error(`${message}: ${failedPath}`, error);
    };

    const getManagedFileList = async (
        directoryPath: string,
        managedRoot: string,
        isManagedRoot: boolean,
    ): Promise<ManagedFileListResult> => {
        let entries: string[];
        try {
            entries = await readFileListDirectory(directoryPath);
        } catch (error: unknown) {
            if (isManagedRoot) throw error;
            recordFileListFailure('failed to enumerate managed subdirectory', directoryPath, error);
            return emptyManagedFileListResult(false);
        }

        const results = emptyManagedFileListResult(true);
        for (const entry of entries) {
            if (entry.startsWith('.')) continue;

            const entryPath = path.resolve(directoryPath, entry);
            if (isManagedEntry(managedRoot, entryPath) === false) continue;

            let isDirectory: boolean;
            let isSymbolicLink: boolean;
            try {
                const stats = fs.lstatSync(entryPath);
                isSymbolicLink = stats.isSymbolicLink();
                isDirectory = stats.isDirectory();
            } catch (error: unknown) {
                recordFileListFailure('failed to inspect managed entry', entryPath, error);
                continue;
            }

            if (isSymbolicLink || isDirectory === false) {
                results.files.push(entryPath);
                continue;
            }

            const subFiles = await getManagedFileList(entryPath, managedRoot, false);
            if (subFiles.enumerationSucceeded === false) continue;
            results.files.push(...subFiles.files);
            results.directories.push(...subFiles.directories);
            results.directories.push(entryPath);
        }

        return results;
    };

    /**
     * 指定したディレクトリ以下の file と directory 一覧を返す
     * @return Promise<FileUtil.FileList>
     */
    export const getFileList = async (fileDir: string): Promise<FileUtil.FileList> => {
        const managedRoot = path.resolve(fileDir);
        const { files, directories } = await getManagedFileList(managedRoot, managedRoot, true);
        return { files, directories };
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
