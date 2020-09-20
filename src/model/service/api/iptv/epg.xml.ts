import { Operation } from 'express-openapi';
import IIPTVApiModel from '../../../api/iptv/IIPTVApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    const iptvApiModel = container.get<IIPTVApiModel>('IIPTVApiModel');

    try {
        const result = await iptvApiModel.getEpg(parseInt(req.query.days as any, 10), req.query.isHalfWidth as any);
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
            $ref: '#/components/parameters/IPTVIsHalfWidth',
        },
        {
            $ref: '#/components/parameters/IPTVDays',
        },
    ],
    responses: {
        200: {
            description: 'epg を取得しました',
            content: {
                'application/xml': {},
            },
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
