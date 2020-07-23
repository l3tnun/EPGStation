import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../../api/video/IVideoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    const videoFileApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        const duration = await videoFileApiModel.getDuration(parseInt(req.params.videoFileId, 10));
        api.responseJSON(res, 200, {
            duration: duration,
        });
    } catch (err) {
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
