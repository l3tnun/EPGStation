import { Operation } from 'express-openapi';
import IThumbnailApiModel from '../../api/thumbnail/IThumbnailApiModel.js';
import container from '../../ModelContainer.js';
import * as api from '../api.js';

/** `POST /thumbnails` ハンドラ。`IThumbnailApiModel#regenerate` で未生成・欠損サムネイルを再生成する。 */
export const post: Operation = async (_req, res) => {
    const thumbnailApiModel = container.get<IThumbnailApiModel>('IThumbnailApiModel');
    try {
        await thumbnailApiModel.regenerate();
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'サムネイル再生成',
    tags: ['thumbnails'],
    description: 'サムネイルの追加で再生成を開始する',
    responses: {
        200: {
            description: 'サムネイルの再生成を開始しました',
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
