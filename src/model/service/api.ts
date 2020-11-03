import * as express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import IPlayList from '../api/IPlayList';

export interface IError {
    readonly code: number;
    readonly message: string;
    errors?: string;
}

export const responseError = (res: express.Response, reason: IError): express.Response => {
    const error: IError = {
        code: reason.code,
        message: reason.message,
    };

    res.status(reason.code);
    res.json(error);

    return res;
};

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

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
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

export const responseFile = (
    req: express.Request,
    res: express.Response,
    filePath: string,
    mime: string,
    download = false,
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
        responseHeaders['Content-Length'] = stat.size;
        responseHeaders['Accept-Ranges'] = 'bytes';
        sendResponse(200, req, res, responseHeaders, req.method === 'HEAD' ? null : fs.createReadStream(filePath));

        return;
    }

    const start: number = rangeRequest.Start;
    const end: number = rangeRequest.End;

    if (start >= stat.size || end >= stat.size) {
        responseHeaders['Content-Range'] = 'bytes */' + stat.size;
        sendResponse(416, req, res, responseHeaders, null);

        return;
    }

    responseHeaders['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    responseHeaders['Content-Length'] = start === end ? 0 : end - start + 1;
    responseHeaders['Accept-Ranges'] = 'bytes';

    const option = { start: start, end: end };
    const stream = fs.createReadStream(filePath, option);
    sendResponse(206, req, res, responseHeaders, stream);
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
    // eslint-disable-next-line @typescript-eslint/ban-types
    responseHeaders: {},
    readable: fs.ReadStream | null,
): void => {
    res.status(code);
    res.set(responseHeaders);

    if (readable === null) {
        res.end();
    } else {
        readable.on('open', () => {
            readable.pipe(res);
        });

        readable.on('end', () => {
            readable.close(); // ファイルを開放する
        });

        // 接続切断時もファイルを開放する
        req.on('close', () => {
            readable.close();
        });
    }
};

export const isSecureProtocol = (req: express.Request): boolean => {
    return req.header('x-forwarded-proto') === 'https' || req.protocol === 'https';
};
