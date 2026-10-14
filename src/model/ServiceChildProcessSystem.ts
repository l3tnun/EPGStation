import * as fs from 'fs';
import FileUtil from '../util/FileUtil.js';
import ProcessUtil from '../util/ProcessUtil.js';

/**
 * OS 上の process の同一性。
 * - `running`: 動いている。`startTime` は Linux の `/proc/<pid>/stat` の 22 番目の値（起動からの clock tick）。
 * - `zombie`: 終了して回収待ち（または回収中）。
 * - `absent`: その PID の process が無い。
 * - `unavailable`: 開始時刻を読めない（Linux 以外、または読取りの失敗）。
 */
export type ProcessIdentity =
    | { readonly status: 'running'; readonly startTime: string }
    | { readonly status: 'zombie' }
    | { readonly status: 'absent' }
    | { readonly status: 'unavailable' };

/**
 * 管理側が、終了した Web・API 側処理の外部プロセスを確かめて止め、ファイルを消すために使う OS の操作。
 */
export interface ProcessSystem {
    /** PID の process の同一性を読む。 */
    identify(pid: number): ProcessIdentity;
    /** PID の process が居るか（`kill(pid, 0)`）。`ESRCH` だけを居ないとみなす。 */
    isAlive(pid: number): boolean;
    /** PID の process へ signal を送る。 */
    signal(pid: number, signal: NodeJS.Signals): void;
    /**
     * process group に、終了済み（zombie）でない member が居るか。全 process の `/proc/<pid>/stat` の 5 番目の値（pgrp）で数える。
     * `/proc` を読めない環境では `undefined`。
     */
    hasLiveGroupMember(pgid: number): boolean | undefined;
    /** process group が居るか（`kill(-pgid, 0)`。zombie だけの group も居るとみなされる）。`ESRCH` 以外の失敗は投げる。 */
    isGroupAlive(pgid: number): boolean;
    /** process group へ signal を送る。 */
    signalGroup(pgid: number, signal: NodeJS.Signals): void;
    /** 指定の時間だけ待つ。 */
    wait(milliseconds: number): Promise<void>;
    /** ファイルを削除する。既に無ければ削除済みとして扱う。 */
    removeFile(filePath: string): Promise<void>;
}

const ABSENT: ProcessIdentity = Object.freeze({ status: 'absent' });
const ZOMBIE: ProcessIdentity = Object.freeze({ status: 'zombie' });
const UNAVAILABLE: ProcessIdentity = Object.freeze({ status: 'unavailable' });

const errorCode = (error: unknown): unknown =>
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;

/**
 * ファイルを削除する。既に無い（`ENOENT`）ときは削除済みとして扱い、それ以外の失敗は投げる。
 * @param filePath 削除するファイル
 */
export const removeFileIfPresent = async (filePath: string): Promise<void> => {
    try {
        await FileUtil.unlink(filePath);
    } catch (error: unknown) {
        if (errorCode(error) !== 'ENOENT') {
            throw error;
        }
    }
};

/**
 * `/proc/<pid>/stat` の 3 番目以降の値を返す。2 番目の値（実行ファイル名）は空白や括弧を含み得るので、最後の `)` の
 * 後ろから数える。返す配列の 0 番目が状態（3 番目の値）、2 番目が pgrp（5 番目の値）、19 番目が開始時刻（22 番目の値）。
 */
const statFields = (stat: string): string[] => stat.slice(stat.lastIndexOf(')') + 2).split(' ');

const isEnded = (state: string): boolean => state === 'Z' || state === 'X';

/**
 * OS の操作を作る。
 * @param platform 動いている OS。`linux` のときだけ `/proc` から開始時刻と process group を読む
 * @param readFile `/proc/<pid>/stat` を読む関数
 * @param readDir `/proc` の名前を列挙する関数
 * @returns OS の操作
 */
export const createProcessSystem = (
    platform: NodeJS.Platform,
    readFile: (path: string, encoding: 'utf8') => string,
    readDir: (path: string) => string[] = path => fs.readdirSync(path),
): ProcessSystem => ({
    identify: pid => {
        if (platform !== 'linux') {
            return UNAVAILABLE;
        }
        let stat: string;
        try {
            stat = readFile(`/proc/${pid}/stat`, 'utf8');
        } catch (error: unknown) {
            return errorCode(error) === 'ENOENT' ? ABSENT : UNAVAILABLE;
        }
        const fields = statFields(stat);
        const startTime = fields[19];
        if (typeof startTime !== 'string' || /^\d+$/u.test(startTime) === false) {
            return UNAVAILABLE;
        }
        return isEnded(fields[0]) ? ZOMBIE : { status: 'running', startTime };
    },
    hasLiveGroupMember: pgid => {
        if (platform !== 'linux') {
            return undefined;
        }
        let names: string[];
        try {
            names = readDir('/proc');
        } catch {
            return undefined;
        }
        const group = String(pgid);
        for (const name of names) {
            if (/^\d+$/u.test(name) === false) {
                continue;
            }
            let fields: string[];
            try {
                fields = statFields(readFile(`/proc/${name}/stat`, 'utf8'));
            } catch {
                // 列挙の後に終わった process は数えない。
                continue;
            }
            if (fields[2] === group && isEnded(fields[0]) === false) {
                return true;
            }
        }
        return false;
    },
    isAlive: pid => {
        try {
            process.kill(pid, 0);
            return true;
        } catch (error: unknown) {
            return errorCode(error) !== 'ESRCH';
        }
    },
    signal: (pid, signal) => {
        process.kill(pid, signal);
    },
    isGroupAlive: pgid => ProcessUtil.isProcessGroupAlive(pgid),
    signalGroup: (pgid, signal) => ProcessUtil.killProcessGroup(pgid, signal),
    wait: milliseconds => ProcessUtil.wait(milliseconds),
    removeFile: removeFileIfPresent,
});

/** 動いている OS 向けの操作。 */
export const nodeProcessSystem: ProcessSystem = createProcessSystem(process.platform, (path, encoding) =>
    fs.readFileSync(path, encoding),
);
