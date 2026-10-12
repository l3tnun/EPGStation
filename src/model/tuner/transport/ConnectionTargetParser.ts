import { posix } from 'node:path';
import { ConnectionTarget } from '../types.js';

const namedPipePrefix = '\\\\.\\pipe\\';
const standardUnixPrefix = 'http+unix://';
const legacyUnixPrefix = 'http://unix:';

const invalidTarget = (): never => {
    throw new Error('Invalid HTTP tuner target');
};

const normalizeBasePath = (path: string): string => {
    const normalized = posix.resolve(path);
    return normalized === '/' ? '' : normalized;
};

const immutable = <T extends ConnectionTarget>(target: T): Readonly<T> => Object.freeze(target);

const unixTarget = (socketPath: string, basePath: string): Readonly<ConnectionTarget> => {
    if (!socketPath.startsWith('/') || !basePath.startsWith('/') || basePath.includes('?') || basePath.includes('#')) {
        return invalidTarget();
    }
    return immutable({ kind: 'unix', socketPath, basePath: normalizeBasePath(basePath) });
};

/**
 * 設定ファイルのチューナーサーバー接続先文字列を`ConnectionTarget`へ変換する。
 * Windows名前付きパイプ（`\\.\pipe\...`）、UNIXドメインソケット（`http+unix://`/`http://unix:`の
 * 2形式）、通常のHTTP URLのいずれかとして解釈し、想定外の形式（HTTPS、認証情報付き、
 * query/hash付き等）は例外を投げる。
 * @param source 設定ファイルに書かれた接続先文字列。
 * @returns 正規化・凍結された`ConnectionTarget`。
 * @throws いずれの形式にも一致しない、または値が不正な場合。
 */
export const parseConnectionTarget = (source: string): Readonly<ConnectionTarget> => {
    if (source.startsWith(namedPipePrefix)) {
        return immutable({ kind: 'named-pipe', socketPath: source, basePath: '' });
    }
    if (source.startsWith(standardUnixPrefix)) {
        const remainder = source.slice(standardUnixPrefix.length);
        const separator = remainder.indexOf('/');
        const encodedSocket = separator === -1 ? remainder : remainder.slice(0, separator);
        const basePath = separator === -1 ? '' : remainder.slice(separator);
        return unixTarget(decodeURIComponent(encodedSocket), basePath || '/');
    }
    if (source.startsWith(legacyUnixPrefix)) {
        const remainder = source.slice(legacyUnixPrefix.length);
        const separator = remainder.indexOf(':');
        if (separator === -1) return invalidTarget();
        return unixTarget(remainder.slice(0, separator), remainder.slice(separator + 1) || '/');
    }

    let url: URL;
    try {
        url = new URL(source);
    } catch {
        return invalidTarget();
    }
    if (
        url.protocol !== 'http:' ||
        url.username !== '' ||
        url.password !== '' ||
        url.search !== '' ||
        url.hash !== ''
    ) {
        return invalidTarget();
    }
    const port = Number(url.port || 80);
    if (port === 0) return invalidTarget();
    return immutable({ kind: 'http', host: url.hostname, port, basePath: normalizeBasePath(url.pathname) });
};
