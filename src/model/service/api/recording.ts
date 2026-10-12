import { Operation } from 'express-openapi';
import { GetRecordedOption } from '../../../../api.js';
import IRecordingApiModel from '../../api/recording/IRecordingApiModel.js';
import container from '../../ModelContainer.js';
import * as api from '../api.js';

/**
 * `GET /recording` ハンドラ。query の各種絞り込み条件（offset / limit / isReverse / ruleId /
 * channelId / genre / keyword / isHalfWidth）から検索条件を組み立て、
 * `IRecordingApiModel#gets` で録画中番組の情報一覧を返す。
 */
export const get: Operation = async (req, res) => {
    const recordingApiModel = container.get<IRecordingApiModel>('IRecordingApiModel');

    try {
        const option: GetRecordedOption = {
            isHalfWidth: req.query.isHalfWidth as any as boolean,
        };
        if (typeof req.query.offset !== 'undefined') {
            option.offset = parseInt(req.query.offset as any, 10);
        }
        if (typeof req.query.limit !== 'undefined') {
            option.limit = parseInt(req.query.limit as any, 10);
        }
        if (typeof req.query.isReverse !== 'undefined') {
            option.isReverse = req.query.isReverse as any;
        }
        if (typeof req.query.ruleId !== 'undefined') {
            option.ruleId = parseInt(req.query.ruleId as any, 10);
        }
        if (typeof req.query.channelId !== 'undefined') {
            option.channelId = parseInt(req.query.channelId as any, 10);
        }
        if (typeof req.query.genre !== 'undefined') {
            option.genre = parseInt(req.query.genre as any, 10);
        }
        if (typeof req.query.keyword === 'string') {
            option.keyword = req.query.keyword;
        }
        api.responseJSON(res, 200, await recordingApiModel.gets(option));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画中情報取得',
    tags: ['recording'],
    description: '録画中情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/Offset',
        },
        {
            $ref: '#/components/parameters/Limit',
        },
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
    ],
    responses: {
        200: {
            description: '録画中情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Records',
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
