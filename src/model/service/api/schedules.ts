import { Operation } from 'express-openapi';
import type * as apid from '../../../../api.js';
import IScheduleApiModel from '../../api/schedule/IScheduleApiModel.js';
import container from '../../ModelContainer.js';
import * as api from '../api.js';

/**
 * `GET /schedules` ハンドラ。期間（startAt/endAt）と種別フィルタ（GR/BS/CS/SKY/isFree等、
 * すべてquery）から検索条件を組み立て、`IScheduleApiModel#getSchedules` で番組表情報を返す。
 * GR/BS/CS/SKYはrequiredなquery（省略不可）だが、BS4Kは任意（`req.query.BS4K`が`boolean`の
 * ときだけoptionへ渡す）。既存clientがBS4Kを付けずに呼んだ場合はoption.BS4Kが`undefined`のまま
 * になり、従来どおりGR/BS/CS/SKYの4種別だけで絞り込まれる。
 */
export const get: Operation = async (req, res) => {
    const scheduleApiModel = container.get<IScheduleApiModel>('IScheduleApiModel');

    try {
        const option: apid.ScheduleOption = {
            startAt: parseInt(req.query.startAt as any, 10),
            endAt: parseInt(req.query.endAt as any, 10),
            isHalfWidth: req.query.isHalfWidth as any,
            needsRawExtended: req.query.needsRawExtended as any,
            GR: req.query.GR as any,
            BS: req.query.BS as any,
            CS: req.query.CS as any,
            SKY: req.query.SKY as any,
        };
        if (typeof req.query.isFree === 'boolean') {
            option.isFree = req.query.isFree;
        }
        if (typeof req.query.BS4K === 'boolean') {
            option.BS4K = req.query.BS4K;
        }
        api.responseJSON(res, 200, await scheduleApiModel.getSchedules(option));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '番組表情報取得',
    tags: ['schedules'],
    description: '番組表情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/StartAt',
        },
        {
            $ref: '#/components/parameters/EndAt',
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
        {
            $ref: '#/components/parameters/requiredGR',
        },
        {
            $ref: '#/components/parameters/requiredBS',
        },
        {
            $ref: '#/components/parameters/requiredCS',
        },
        {
            $ref: '#/components/parameters/requiredSKY',
        },
        {
            $ref: '#/components/parameters/optionalBS4K',
        },
    ],
    responses: {
        200: {
            description: '番組表情報を取得しました',
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
