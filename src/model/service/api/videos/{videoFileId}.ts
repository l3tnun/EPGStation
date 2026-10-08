import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../api/video/IVideoApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

/**
 * `GET /videos/{videoFileId}` ハンドラ。`IVideoApiModel#openDelivery` で読み取りリースを
 * 取得してビデオファイルを返す（未実装環境向けの後方互換分岐は直後のinlineコメント参照）。
 * `isDownload`（query）でダウンロード/インライン再生を切り替える。取得できなかった場合
 * （`null`）は404。client切断（`closed`）をreaderへ伝えつつ、応答完了後に必ず
 * `delivery.release()`でリースを解放する。
 */
export const get: Operation = async (req, res) => {
    const videoFileApiModel = container.get<IVideoApiModel>('IVideoApiModel');
    let closed = false;
    req.once('close', () => {
        closed = true;
    });

    try {
        // Existing in-process owner doubles predate delivery ownership.  The
        // production VideoApiModel always implements openDelivery; retaining
        // this narrow compatibility branch keeps the established owner wire
        // contract without reintroducing a production DB/path fallback.
        if (typeof videoFileApiModel.openDelivery !== 'function') {
            const fileInfo = await videoFileApiModel.getFullFilePath(parseInt(api.pathParam(req, 'videoFileId'), 10));
            if (fileInfo === null) {
                api.responseError(res, {
                    code: 404,
                    message: 'video file is not found',
                });
            } else {
                api.responseFile(req, res, fileInfo.path, fileInfo.mime, req.query.isDownload as any as boolean);
            }
            return;
        }
        const delivery = await videoFileApiModel.openDelivery(
            parseInt(api.pathParam(req, 'videoFileId'), 10),
            () => !closed,
        );

        if (delivery === null) {
            api.responseError(res, {
                code: 404,
                message: 'video file is not found',
            });
        } else {
            try {
                api.responseFile(
                    req,
                    res,
                    delivery.path,
                    delivery.mime,
                    req.query.isDownload as any as boolean,
                    () => delivery.release(),
                    delivery.reader?.readable,
                    delivery.isTail,
                );
            } catch (error) {
                await delivery.release();
                throw error;
            }
        }
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ビデオファイル',
    tags: ['videos'],
    description: 'ビデオファイルを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
        {
            $ref: '#/components/parameters/IsDownload',
        },
    ],
    responses: {
        200: {
            description: 'ビデオファイルを取得しました',
            content: {
                'video/mp2t': {},
                'video/mp4': {},
                'video/x-matroska': {},
                'video/webm': {},
                'application/octet-stream': {},
            },
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};

/** `DELETE /videos/{videoFileId}` ハンドラ。`IVideoApiModel#deleteVideoFile` でビデオファイルを削除する。 */
export const del: Operation = async (req, res) => {
    const videoFileApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        await videoFileApiModel.deleteVideoFile(parseInt(api.pathParam(req, 'videoFileId'), 10));
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'ビデオファイル',
    tags: ['videos'],
    description: 'ビデオファイルを削除する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
    ],
    responses: {
        200: {
            description: 'ビデオファイルを削除しました',
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};
