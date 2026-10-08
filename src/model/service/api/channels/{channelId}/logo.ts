import { Operation } from 'express-openapi';
import IChannelApiModel, { IChannelApiModelError } from '../../../../api/channel/IChannelApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';

/**
 * `GET /channels/{channelId}/logo` ハンドラ。`IChannelApiModel#getLogo` でロゴ画像データを
 * 取得して`image/png`で返す。`IChannelApiModelError.NOT_FOUND`は404、それ以外の例外は500。
 */
export const get: Operation = async (req, res) => {
    const channelApiModel = container.get<IChannelApiModel>('IChannelApiModel');

    try {
        const result = await channelApiModel.getLogo(parseInt(api.pathParam(req, 'channelId'), 10));
        res.setHeader('Content-Type', 'image/png');
        res.status(200);
        res.end(result);
    } catch (err: any) {
        if (err.message === IChannelApiModelError.NOT_FOUND) {
            api.responseError(res, {
                code: 404,
                message: 'log file is not found',
            });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

get.apiDoc = {
    summary: '放送局ロゴ取得',
    tags: ['channels'],
    description: '放送局のロゴを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathChannelId',
        },
    ],
    responses: {
        200: {
            description: '放送局のロゴを取得しました',
            content: {
                'image/png': {},
            },
        },
        404: {
            description: 'Not Found',
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
