import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../../api/video/IVideoApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';

/** `GET /videos/{videoFileId}/duration` ハンドラ。`IVideoApiModel#getDuration` で動画の長さ（秒）を取得する。 */
export const get: Operation = async (req, res) => {
    const videoFileApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const duration = await videoFileApiModel.getDuration(parseInt(api.pathParam(req, 'videoFileId'), 10));
        api.responseJSON(res, 200, {
            duration: duration,
        });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '動画の長さ',
    tags: ['videos'],
    description: '動画の長さを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
    ],
    responses: {
        200: {
            description: '動画の長さを取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/VideoFileDuration',
                    },
                },
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
