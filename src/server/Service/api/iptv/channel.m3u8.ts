import { Operation } from 'express-openapi';
import { IPTVModelInterface } from '../../../Model/Api/IPTVModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const get: Operation = async(req, res) => {
    const iptv = <IPTVModelInterface> factory.get('IPTVModel');

    try {
        const result = await iptv.getChannelList(
            req.headers.host!,
            req.header('x-forwarded-proto') === 'https',
            req.query.mode as any as number,
        );
        res.setHeader('Content-Type', 'application/x-mpegURL; charset="UTF-8"');
        res.status(200);
        res.end(result);
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'IPTV channel list を取得',
    tags: ['iptv'],
    description: 'IPTV channel list を取得する',
    parameters: [
        {
            name: 'mode',
            in: 'query',
            description: 'encode mode',
            required: true,
            type: 'integer',
        },
    ],
    produces: ['application/x-mpegURL'],
    responses: {
        200: {
            description: 'channel list を取得しました',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

