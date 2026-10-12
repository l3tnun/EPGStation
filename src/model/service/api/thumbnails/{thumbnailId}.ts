import { Operation } from 'express-openapi';
import IThumbnailApiModel from '../../../api/thumbnail/IThumbnailApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

/**
 * `GET /thumbnails/{thumbnailId}` ハンドラ。`IThumbnailApiModel#getIdFilePath` で画像の
 * 絶対パスを取得し、`image/jpeg` として返す。パスが `null`（該当サムネイルなし）の場合は404。
 */
export const get: Operation = async (req, res) => {
    const thumbnailApiModel = container.get<IThumbnailApiModel>('IThumbnailApiModel');

    try {
        const filePath = await thumbnailApiModel.getIdFilePath(parseInt(api.pathParam(req, 'thumbnailId'), 10));

        if (filePath === null) {
            api.responseError(res, {
                code: 404,
                message: 'thumbnail is not Found',
            });
        } else {
            res.header('Cache-Control', 'private, max-age=14400');
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

/** `DELETE /thumbnails/{thumbnailId}` ハンドラ。`IThumbnailApiModel#delete` でサムネイルを削除する。 */
export const del: Operation = async (req, res) => {
    const thumbnailApiModel = container.get<IThumbnailApiModel>('IThumbnailApiModel');

    try {
        await thumbnailApiModel.delete(parseInt(api.pathParam(req, 'thumbnailId'), 10));

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
