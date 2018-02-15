import { Operation } from 'express-openapi';
import * as api from '../../../api';
import factory from '../../../../Model/ModelFactory';
import { ChannelsModelInterface } from '../../../../Model/Api/ChannelsModel';


export const get: Operation = async (req, res) => {
    let channels = <ChannelsModelInterface>(factory.get('ChannelsModel'));

    try {
        let result = await channels.getIPTVChannelList(req.headers.host, req.secure, req.query.mode);
        res.setHeader('Content-Type', 'application/x-mpegURL; charset="UTF-8"');
        res.status(200);
        res.end(result);
    } catch(err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'IPTV channel list を取得',
    tags: ['channels'],
    description: 'IPTV channel list を取得する',
    parameters: [
        {
            name: 'mode',
            in: 'query',
            description: 'encode mode',
            required: true,
            type: 'integer',
        }
    ],
    produces: ["application/x-mpegURL"],
    responses: {
        200: {
            description: 'channel list を取得しました'
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error'
            }
        }
    }
};

