import { Operation } from 'express-openapi';
import IStreamApiModel from '../../../../api/stream/IStreamApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';

/**
 * `PUT /streams/{streamId}/keep` ハンドラ。`IStreamApiModel#keep` で停止タイマーを延長し、
 * client から視聴継続中であることを伝える定期呼び出しを受ける。
 */
export const put: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    try {
        await streamApiModel.keep(parseInt(api.pathParam(req, 'streamId'), 10));
        api.responseJSON(res, 200, {
            code: 200,
        });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'ストリーム停止タイマーを更新する',
    tags: ['streams'],
    description: 'ストリーム停止タイマーを更新する',
    parameters: [
        {
            $ref: '#/components/parameters/PathStreamId',
        },
    ],
    responses: {
        200: {
            description: 'ストリーム停止タイマーを更新しました',
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
