import { Operation } from 'express-openapi';
import type * as apid from '../../../../../api.js';
import IScheduleApiModel from '../../../api/schedule/IScheduleApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

/**
 * `GET /schedules/{channelId}` ハンドラ。開始時刻（startAt）・日数（days）・種別フィルタ
 * （query）から検索条件を組み立て、`IScheduleApiModel#getChannelSchedule` で指定放送局の
 * 番組表情報を返す。
 */
export const get: Operation = async (req, res) => {
    const scheduleApiModel = container.get<IScheduleApiModel>('IScheduleApiModel');

    try {
        const option: apid.ChannelScheduleOption = {
            startAt: parseInt(req.query.startAt as any, 10),
            days: parseInt(req.query.days as any, 10),
            isHalfWidth: req.query.isHalfWidth as any,
            needsRawExtended: req.query.needsRawExtended as any,
            channelId: parseInt(api.pathParam(req, 'channelId'), 10),
        };
        if (typeof req.query.isFree === 'boolean') {
            option.isFree = req.query.isFree;
        }
        api.responseJSON(res, 200, await scheduleApiModel.getChannelSchedule(option));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '指定された放送局の番組表情報取得',
    tags: ['schedules'],
    description: '指定された放送局の番組表情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathChannelId',
        },
        {
            $ref: '#/components/parameters/StartAt',
        },
        {
            $ref: '#/components/parameters/Days',
        },
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
        {
            $ref: '#/components/parameters/NeedsRawExtended',
        },
        {
            $ref: '#/components/parameters/IsFreeProgram',
        },
    ],
    responses: {
        200: {
            description: '指定された放送局の番組表情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Schedules',
                    },
                },
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
