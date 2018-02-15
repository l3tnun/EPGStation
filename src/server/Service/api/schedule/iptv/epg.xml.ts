import { Operation } from 'express-openapi';
import * as api from '../../../api';
import factory from '../../../../Model/ModelFactory';
import { ScheduleModelInterface } from '../../../../Model/Api/ScheduleModel';

export const get: Operation = async (_req, res) => {
    let schedules = <ScheduleModelInterface>(factory.get('ScheduleModel'));

    try {
        let result = await schedules.getIPTVepg();
        res.setHeader('Content-Type', 'application/xml; charset="UTF-8"');
        res.status(200);
        res.end(result);
    } catch(err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'IPTV epg を取得',
    tags: ['schedule'],
    description: 'IPTV epg を取得する',
    produces: ["application/xml"],
    responses: {
        200: {
            description: 'epg を取得しました'
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error'
            }
        }
    }
};

