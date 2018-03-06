import { Operation } from 'express-openapi';
import { IPTVModelInterface } from '../../../Model/Api/IPTVModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const get: Operation = async(req, res) => {
    const iptv = <IPTVModelInterface> factory.get('IPTVModel');

    try {
        const result = await iptv.getEpg(req.query.days);
        res.setHeader('Content-Type', 'application/xml; charset="UTF-8"');
        res.status(200);
        res.end(result);
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'IPTV epg を取得',
    tags: ['iptv'],
    description: 'IPTV epg を取得する',
    parameters: [
        {
            name: 'days',
            in: 'query',
            description: '表示する日数',
            type: 'integer',
            minimum: 1,
            maximum: 8,
            default: 3,
        },
    ],
    produces: ['application/xml'],
    responses: {
        200: {
            description: 'epg を取得しました',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

