import { Operation } from 'express-openapi';
import IChannelApiModel, { IChannelApiModelError } from '../../../../api/channel/IChannelApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const get: Operation = async (req, res) => {
    const channelApiModel = container.get<IChannelApiModel>('IChannelApiModel');

    try {
        const result = await channelApiModel.getLogo(parseInt(req.params.channelId, 10));
        res.setHeader('Content-Type', 'image/png');
        res.status(200);
        res.end(result);
    } catch (err) {
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
    summary: '放送局ログ取得',
    tags: ['channels'],
    description: '放送局のログを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathChannelId',
        },
    ],
    responses: {
        200: {
            description: '放送局のログを取得しました',
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
