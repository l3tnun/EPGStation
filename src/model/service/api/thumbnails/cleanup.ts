import { Operation } from 'express-openapi';
import IThumbnailApiModel from '../../../api/thumbnail/IThumbnailApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

/** `POST /thumbnails/cleanup` ハンドラ。`IThumbnailApiModel#fileCleanup` で実体の無いサムネイルファイルのDBレコードを掃除する。 */
export const post: Operation = async (_req, res) => {
    const thumbnailApiModel = container.get<IThumbnailApiModel>('IThumbnailApiModel');
    try {
        await thumbnailApiModel.fileCleanup();
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'サムネイルをクリーンアップ',
    tags: ['thumbnails'],
    description: 'サムネイルをクリーンアップする',
    responses: {
        200: {
            description: 'サムネイルをクリーンアップしました',
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
