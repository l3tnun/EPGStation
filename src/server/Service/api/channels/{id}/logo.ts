import { Operation } from 'express-openapi';
import { ChannelsModelInterface } from '../../../../Model/Api/ChannelsModel';
import factory from '../../../../Model/ModelFactory';
import * as api from '../../../api';


export const get: Operation = async(req, res) => {
    const channels = <ChannelsModelInterface> factory.get('ChannelsModel');

    try {
        const results = await channels.getLogo(req.params.id);
        res.setHeader('Content-Type', 'image/png');
        res.status(200);
        res.end(results);
    } catch (err) {
        if (err.message === ChannelsModelInterface.NotFoundChannelIdError) {
            api.responseError(res, { code: 400,  message: 'Channel Id is not Found' });
        } else if (err.message === ChannelsModelInterface.NotFoundLogoError) {
            api.responseError(res, { code: 503,  message: 'Logo Data Unavailable' });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

get.apiDoc = {
    summary: 'channel log を取得',
    tags: ['channels'],
    description: 'channel log を取得する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'rule id',
            required: true,
            type: 'integer',
        },
    ],
    produces: ['image/png'],
    responses: {
        200: {
            description: 'channel logo を取得しました',
        },
        400: {
            description: 'channel id の指定が間違っている',
        },
        503: {
            description: 'Logo データが利用できない',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

