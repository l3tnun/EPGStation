import { Operation } from 'express-openapi';
import IIPTVApiModel from '../../../api/iptv/IIPTVApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    const iptvApiModel = container.get<IIPTVApiModel>('IIPTVApiModel');

    try {
        if (typeof req.headers.host === 'undefined') {
            throw new Error('HostIsUndefined');
        }

        const result = await iptvApiModel.getChannelList(
            req.headers.host,
            api.isSecureProtocol(req),
            parseInt(req.query.mode as any, 10),
            req.query.isHalfWidth as any,
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
            $ref: '#/components/parameters/IPTVIsHalfWidth',
        },
        {
            $ref: '#/components/parameters/StreamMode',
        },
    ],
    responses: {
        200: {
            description: 'channel list を取得しました',
            content: {
                'application/x-mpegURL': {},
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
