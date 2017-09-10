import { Operation } from 'express-openapi';
import * as api from '../api';
import factory from '../../Model/ModelFactory';
import { ChannelsModelInterface } from '../../Model/Api/ChannelsModel';

export const get: Operation = async (_req, res) => {
    let channels = <ChannelsModelInterface>(factory.get('ChannelsModel'));

    try {
        let results = await channels.getAll();
        api.responseJSON(res, 200, results);
    } catch(err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'channel を取得',
    tags: ['channels'],
    description: 'channel を取得する',
    responses: {
        200: {
            description: 'channel を取得しました',
            schema: {
                type: 'array',
                 items: {
                    $ref: '#/definitions/ServiceItem'
                 }
            }
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error'
            }
        }
    }
};

