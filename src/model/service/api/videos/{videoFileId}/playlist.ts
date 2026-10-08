import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../../api/video/IVideoApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';

/**
 * `GET /videos/{videoFileId}/playlist` ハンドラ。`IVideoApiModel#getM3u8` で、request の
 * host/scheme を使ってビデオファイル再生用のm3u8プレイリストを取得する。対象が存在しない
 * 場合（`null`）は404。
 */
export const get: Operation = async (req, res) => {
    const videoFileApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        if (typeof req.headers.host === 'undefined') {
            throw new Error('HostIsUndefined');
        }

        const playlist = await videoFileApiModel.getM3u8(
            req.headers.host,
            api.isSecureProtocol(req),
            parseInt(api.pathParam(req, 'videoFileId'), 10),
        );

        if (playlist === null) {
            api.responseError(res, {
                code: 404,
                message: 'play list is not found',
            });
        } else {
            api.responsePlayList(req, res, playlist);
        }
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ビデオプレイリスト',
    tags: ['videos'],
    description: 'ビデオプレイリストを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
    ],
    responses: {
        200: {
            description: 'ビデオプレイリストを取得しました',
            content: {
                'application/x-mpegURL': {},
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
