import { Operation } from 'express-openapi';
import IThumbnailApiModel from '../../../../api/thumbnail/IThumbnailApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';

/** `POST /thumbnails/videos/{videoFileId}` ハンドラ。`IThumbnailApiModel#add` で指定ビデオファイルのサムネイル生成を開始させる。 */
export const post: Operation = async (req, res) => {
    const thumbnailApiModel = container.get<IThumbnailApiModel>('IThumbnailApiModel');

    try {
        await thumbnailApiModel.add(parseInt(api.pathParam(req, 'videoFileId'), 10));
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'サムネイル追加',
    tags: ['thumbnails'],
    description: 'サムネイルの生成を開始させる',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
    ],
    responses: {
        200: {
            description: '追加サムネイルの生成を開始しました',
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
