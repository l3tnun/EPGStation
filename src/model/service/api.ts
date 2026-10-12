import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { INVALID_SUB_DIRECTORY_ERROR } from '../../util/SubDirectoryUtil.js';
import IPlayList from '../api/IPlayList.js';
import { RESERVATION_NOT_EDITABLE_ERROR } from '../operator/reservation/ReservationNotEditableError.js';

/** API route ハンドラがエラー応答として返す共通形式。`code`はHTTP status codeとして
 *  そのまま使う。`errors`は補足のエラーメッセージ（無ければ省略）。 */
export interface IError {
    readonly code: number;
    readonly message: string;
    errors?: string;
}

/**
 * `reason`の内容でHTTPエラーレスポンスを返す。
 * @param res 応答先。
 * @param reason status codeとメッセージ（`errors`は転記しない）。
 * @returns 呼び出し元が続けて処理を打ち切れるよう、渡された`res`をそのまま返す。
 */
export const responseError = (res: express.Response, reason: IError): express.Response => {
    const error: IError = {
        code: reason.code,
        message: reason.message,
    };

    res.status(reason.code);
    res.json(error);

    return res;
};

/**
 * 500 Internal Server Errorとして応答する。
 * @param res 応答先。
 * @param err 追加のエラーメッセージ。指定した場合のみ`IError.errors`に載せる。
 * @returns 渡された`res`をそのまま返す。
 */
export const responseServerError = (res: express.Response, err?: string): express.Response => {
    const error: IError = {
        code: 500,
        message: 'Internal Server Error',
    };

    if (typeof err !== 'undefined') {
        error.errors = err;
    }

    res.status(error.code);
    res.json(error);

    return res;
};

/** 担当機能の拒否のうち、500 以外の status で応答するものの status と`message`。 */
const OPERATION_ERROR_RESPONSES: ReadonlyMap<string, { readonly code: number; readonly message: string }> = new Map([
    [INVALID_SUB_DIRECTORY_ERROR, { code: 400, message: 'Bad Request' }],
    [RESERVATION_NOT_EDITABLE_ERROR, { code: 409, message: 'Conflict' }],
]);

/**
 * 担当機能の失敗を応答する。保存先内ディレクトリが録画保存先の外を指すことによる拒否は入力エラーとして
 * 400 Bad Request で、編集の対象ではない予約の編集の拒否は 409 Conflict で、それ以外は 500 Internal Server Error で
 * 応答する。
 * @param res 応答先。
 * @param err 担当機能が投げたエラー。`message`で拒否の理由を判別する（IPCを越えてもメッセージは保たれる）。
 * @returns 渡された`res`をそのまま返す。
 */
export const responseOperationError = (res: express.Response, err: Error): express.Response => {
    const reason = OPERATION_ERROR_RESPONSES.get(err.message);
    if (typeof reason === 'undefined') {
        return responseServerError(res, err.message);
    }

    const error: IError = {
        code: reason.code,
        message: reason.message,
        errors: err.message,
    };

    res.status(error.code);
    res.json(error);

    return res;
};

/**
 * path parameter を文字列として取り出す
 *
 * Express 5 の型は wildcard route（`/foo/*name`）を含むため、`req.params` の値は
 * `string | string[]` になる。本 project の route は `:name` 形式だけを使うので配列は
 * 現れないが、型の上では絞る必要がある。wildcard が来た場合は Express が組み立てる
 * 経路と同じ形へ戻す。
 */
export const pathParam = (req: express.Request, name: string): string => {
    const value = req.params[name];

    return Array.isArray(value) ? value.join('/') : value;
};

/**
 * 通常のJSON応答を返す。ブラウザ・中間proxyにキャッシュさせないためのヘッダを付ける。
 * @param res 応答先。
 * @param code 応答するHTTP status code。
 * @param body JSONへ変換して返す本体（省略時は`undefined`がそのまま`res.json`へ渡る）。
 * @returns 渡された`res`をそのまま返す。
 */
export const responseJSON = (res: express.Response, code: number, body?: any): express.Response => {
    res.status(code);
    // non-cache
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');
    res.json(body);

    return res;
};

/**
 * PlayList を m3u8 としてレスポンスする
 */
export const responsePlayList = (req: express.Request, res: express.Response, list: IPlayList): void => {
    res.setHeader('Content-Type', 'application/x-mpegURL; charset="UTF-8"');
    const disposition = /firefox|Firefox/.test(<string>req.headers['user-agent']) ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${list.name};`);
    res.status(200);
    res.write(list.playList);
    res.end();
};

/**
 * fileを1件、Rangeリクエストに対応した形でレスポンスする。`providerReadable`を渡した場合は
 * `fs.createReadStream`の代わりにそれを配信元として使う（録画中fileのtail読み出し等、
 * 呼び出し元が既にreaderを持っている場合向け）。
 * @param req 元のHTTPリクエスト（Range headerの読み取り、close検知に使う）。
 * @param res 応答先。
 * @param filePath `providerReadable`未指定時に読み出す実fileのパス（サイズ取得にも使う）。
 * @param mime `download`が`false`の場合のContent-Type。
 * @param download `true`の場合、添付ダウンロードとして`Content-Disposition`を付ける。
 * @param onTerminal 応答が終端（正常終了・切断・エラーのいずれか）に達したとき1回だけ呼ばれる
 *  後始末callback（`providerReadable`の貸し出し元がリースを解放する等の用途）。
 * @param providerReadable 配信元として使う読み取り済みstream。省略時は`filePath`を都度開く。
 * @param isProviderTail `providerReadable`が録画進行中で今後もサイズが伸びる（tail読み出し中の）
 *  fileかどうか。`true`の場合、Range未指定の通常応答でも`Content-Length`を付けない。
 */
export const responseFile = (
    req: express.Request,
    res: express.Response,
    filePath: string,
    mime: string,
    download = false,
    onTerminal?: () => Promise<void> | void,
    providerReadable?: NodeJS.ReadableStream,
    isProviderTail: boolean = false,
): void => {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
        throw new Error('file path is derectory');
    }

    const responseHeaders: any = {};
    if (download) {
        responseHeaders['Content-Type'] = 'application/octet-stream';
        responseHeaders['Content-disposition'] = `attachment; filename*=utf-8'ja'${encodeURIComponent(
            path.basename(filePath),
        )};`;
    } else {
        responseHeaders['Content-Type'] = mime;
    }

    const rangeRequest = readRangeHeader(req.headers['range'], stat.size);

    if (rangeRequest === null) {
        if (providerReadable === undefined || isProviderTail === false || req.method === 'HEAD') {
            responseHeaders['Content-Length'] = stat.size;
        }
        responseHeaders['Accept-Ranges'] = 'bytes';
        sendResponse(
            200,
            req,
            res,
            responseHeaders,
            req.method === 'HEAD' ? null : (providerReadable ?? fs.createReadStream(filePath)),
            onTerminal,
            providerReadable !== undefined,
        );

        return;
    }

    const start: number = rangeRequest.Start;
    const end: number = rangeRequest.End;

    if (start >= stat.size || end >= stat.size) {
        responseHeaders['Content-Range'] = 'bytes */' + stat.size;
        sendResponse(416, req, res, responseHeaders, null, onTerminal);

        return;
    }

    responseHeaders['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    responseHeaders['Content-Length'] = end - start + 1;
    responseHeaders['Accept-Ranges'] = 'bytes';

    const option = { start: start, end: end };
    const stream = fs.createReadStream(filePath, option);
    sendResponse(206, req, res, responseHeaders, stream, onTerminal);
};

const readRangeHeader = (
    range: string | string[] | undefined | null,
    totalLength: number,
): { Start: number; End: number } | null => {
    if (typeof range !== 'string' || range === null || range.length === 0) {
        return null;
    }

    const array = range.split(/bytes=([0-9]*)-([0-9]*)/);
    const start = parseInt(array[1], 10);
    const end = parseInt(array[2], 10);
    const result = {
        Start: isNaN(start) ? 0 : start,
        End: isNaN(end) ? totalLength - 1 : end,
    };

    if (!isNaN(start) && isNaN(end)) {
        result.Start = start;
        result.End = totalLength - 1;
    }

    if (isNaN(start) && !isNaN(end)) {
        result.Start = totalLength - end;
        result.End = totalLength - 1;
    }

    return result;
};

const sendResponse = (
    code: number,
    req: express.Request,
    res: express.Response,
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    responseHeaders: {},
    readable: NodeJS.ReadableStream | null,
    onTerminal?: () => Promise<void> | void,
    isProviderReadable: boolean = false,
): void => {
    const destroyReadable = (): void => {
        if (readable === null) return;
        const destroy = (readable as NodeJS.ReadableStream & { destroy?: () => void }).destroy;
        if (typeof destroy === 'function') destroy.call(readable);
    };
    let terminal = false;
    const finalizeOnce = (): void => {
        if (terminal) return;
        terminal = true;
        req.removeListener('close', onRequestClose);
        res.removeListener('finish', finalizeOnce);
        res.removeListener('close', finalizeOnce);
        readable?.removeListener('close', finalizeOnce);
        readable?.removeListener('error', onReadableError);
        if (onTerminal !== undefined) {
            void Promise.resolve(onTerminal()).catch(() => {
                // The delivery owner records release failures without changing this HTTP terminal outcome.
            });
        }
    };
    const onRequestClose = (): void => {
        destroyReadable();
        finalizeOnce();
    };
    const onReadableError = (): void => {
        finalizeOnce();
        if (res.destroyed === false) res.destroy();
    };

    if (onTerminal !== undefined) {
        req.once('close', onRequestClose);
        res.once('finish', finalizeOnce);
        res.once('close', finalizeOnce);
        readable?.once('close', finalizeOnce);
        readable?.once('error', onReadableError);
    }
    res.status(code);
    res.set(responseHeaders);

    if (readable === null) {
        res.end();
    } else {
        if (isProviderReadable) {
            readable.pipe(res);
        } else {
            readable.on('open', () => {
                readable.pipe(res);
            });
        }

        readable.on('end', () => {
            if (isProviderReadable === false) destroyReadable();
        });

        // 接続切断時もファイルを開放する
        if (onTerminal === undefined) {
            req.on('close', () => {
                destroyReadable();
            });
        }
    }
};

/**
 * リクエストがHTTPS経由かどうかを判定する。reverse proxy越しの場合は`req.protocol`だけでは
 * 判定できないため、`X-Forwarded-Proto`（大文字・小文字表記のいずれか）も見る。
 * @param req 判定対象のリクエスト。
 * @returns HTTPSと判定できれば`true`。
 */
export const isSecureProtocol = (req: express.Request): boolean => {
    return (
        req.header('x-forwarded-proto') === 'https' ||
        req.header('X-Forwarded-Proto') === 'https' ||
        req.protocol === 'https'
    );
};
