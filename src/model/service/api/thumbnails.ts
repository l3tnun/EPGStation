import { Operation } from 'express-openapi';
import IThumbnailApiModel from '../../api/thumbnail/IThumbnailApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const post: Operation = async (_req, res) => {
    const thumbnailApiModel = container.get<IThumbnailApiModel>('IThumbnailApiModel');
    try {
        await thumbnailApiModel.regenerate();
        api.responseJSON(res, 200, { code: 200 });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'サムネイル再生成',
    tags: ['thumbnails'],
    description: 'サムネイルの再生成を開始する',
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
