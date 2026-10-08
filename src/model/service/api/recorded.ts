import { Operation } from 'express-openapi';
import { GetRecordedOption } from '../../../../api.js';
import IRecordedApiModel from '../../api/recorded/IRecordedApiModel.js';
import container from '../../ModelContainer.js';
import * as api from '../api.js';

/**
 * `GET /recorded` ハンドラ。query の各種絞り込み条件（offset / limit / isReverse / ruleId /
 * channelId / genre / keyword / hasOriginalFile）から検索条件を組み立て、
 * `IRecordedApiModel#gets` で録画一覧を返す。
 */
export const get: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

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
        if (typeof req.query.hasOriginalFile !== 'undefined') {
            option.hasOriginalFile = req.query.hasOriginalFile as any;
        }

        api.responseJSON(res, 200, await recordedApiModel.gets(option));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画情報取得',
    tags: ['recorded'],
    description: '録画情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
        {
            $ref: '#/components/parameters/Offset',
        },
        {
            $ref: '#/components/parameters/Limit',
        },
        {
            $ref: '#/components/parameters/IsReverse',
        },
        {
            $ref: '#/components/parameters/QueryRuleId',
        },
        {
            $ref: '#/components/parameters/QueryChannelId',
        },
        {
            $ref: '#/components/parameters/QueryProgramGenre',
        },
        {
            $ref: '#/components/parameters/QueryKeyword',
        },
        {
            $ref: '#/components/parameters/QueryHasOriginalFile',
        },
    ],
    responses: {
        200: {
            description: '録画情報を取得しました',
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

/** `POST /recorded` ハンドラ。`IRecordedApiModel#createNewRecorded` で録画情報を新規作成する。 */
export const post: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        api.responseJSON(res, 201, {
            recordedId: await recordedApiModel.createNewRecorded(req.body),
        });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: '録画番組情報の新規作成',
    tags: ['recorded'],
    description: '録画番組情報を新規作成する',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/CreateNewRecordedOption',
                },
            },
        },
        required: true,
    },
    responses: {
        201: {
            description: '録画番組情報の新規作成に成功した',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/CreatedNewRecorded',
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
