import { Operation } from 'express-openapi';
import * as api from '../../api';
import factory from '../../../Model/ModelFactory';
import { ScheduleModelInterface } from '../../../Model/Api/ScheduleModel';

export const put: Operation = async (_req, res) => {
     let schedules = <ScheduleModelInterface>(factory.get('ScheduleModel'));

    try {
        await schedules.updateReserves();
        api.responseJSON(res, 200, { code: 200 });
    } catch(err) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: '予約情報を更新を開始',
    tags: ['schedule'],
    description: '予約情報を更新を開始する',
    responses: {
        200: {
            description: '予約情報を更新を開始しました',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error'
            }
        }
    }
};

