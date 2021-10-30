import { Operation } from 'express-openapi';
import IThumbnailApiModel from '../../../api/thumbnail/IThumbnailApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    const thumbnailApiModel = container.get<IThumbnailApiModel>('IThumbnailApiModel');

    try {
        const filePath = await thumbnailApiModel.getIdFilePath(parseInt(req.params.thumbnailId, 10));

        if (filePath === null) {
            api.responseError(res, {
                code: 404,
                message: 'thumbnail is not Found',
            });
        } else {
            api.responseFile(req, res, filePath, 'image/jpeg', false);
        }
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'サムネイル',
    tags: ['thumbnails'],
    description: 'サムネイルを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathThumbnailId',
        },
    ],
    responses: {
        200: {
            description: 'サムネイルを取得しました',
            content: {
                'image/jpeg': {},
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

export const del: Operation = async (req, res) => {
    const thumbnailApiModel = container.get<IThumbnailApiModel>('IThumbnailApiModel');

    try {
        await thumbnailApiModel.delete(parseInt(req.params.thumbnailId, 10));

        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'サムネイル',
    tags: ['thumbnails'],
    description: 'サムネイルを削除する',
    parameters: [
        {
            $ref: '#/components/parameters/PathThumbnailId',
        },
    ],
    responses: {
        200: {
            description: 'サムネイルを削除しました',
            content: {
                'image/jpeg': {},
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
