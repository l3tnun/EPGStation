import { Operation } from 'express-openapi';
import IScheduleApiModel from '../../../../api/schedule/IScheduleApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';

/**
 * `GET /schedules/detail/{programId}` ハンドラ。`IScheduleApiModel#getSchedule` で番組1件の
 * 詳細を取得する。`getSchedule` が `null`（該当番組なし）を返した場合は404を返す。
 */
export const get: Operation = async (req, res) => {
    const scheduleApiModel = container.get<IScheduleApiModel>('IScheduleApiModel');

    try {
        const program = await scheduleApiModel.getSchedule(
            parseInt(api.pathParam(req, 'programId'), 10),
            req.query.isHalfWidth as any,
        );
        if (program === null) {
            api.responseError(res, {
                code: 404,
                message: 'program is not found',
            });
        } else {
            api.responseJSON(res, 200, program);
        }
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '指定された番組表情報取得',
    tags: ['schedules'],
    description: '指定された番組表情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathProgramId',
        },
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
    ],
    responses: {
        200: {
            description: '指定された番組表情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/ScheduleProgramItem',
                    },
                },
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
