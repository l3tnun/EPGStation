import { Operation } from 'express-openapi';
import type * as apid from '../../../../api.js';
import IRuleApiModel from '../../api/rule/IRuleApiModel.js';
import container from '../../ModelContainer.js';
import * as api from '../api.js';

/**
 * `GET /rules` ハンドラ。query の offset / limit / type / keyword から検索条件を組み立て、
 * `IRuleApiModel#gets` でルール一覧を返す。
 */
export const get: Operation = async (req, res) => {
    const ruleApiModel = container.get<IRuleApiModel>('IRuleApiModel');

    try {
        const option: apid.GetRuleOption = {};
        if (typeof req.query.offset !== 'undefined') {
            option.offset = parseInt(req.query.offset as any, 10);
        }
        if (typeof req.query.limit !== 'undefined') {
            option.limit = parseInt(req.query.limit as any, 10);
        }
        if (typeof req.query.type !== 'undefined') {
            option.type = req.query.type as any;
        }
        if (typeof req.query.keyword === 'string') {
            option.keyword = req.query.keyword;
        }

        api.responseJSON(res, 200, await ruleApiModel.gets(option));
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ルール情報取得',
    tags: ['rules'],
    description: 'ルール情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/Offset',
        },
        {
            $ref: '#/components/parameters/Limit',
        },
        {
            $ref: '#/components/parameters/GetReserveType',
        },
        {
            $ref: '#/components/parameters/QueryKeyword',
        },
    ],
    responses: {
        200: {
            description: 'ルール情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Rules',
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

/** `POST /rules` ハンドラ。`IRuleApiModel#add` でルールを追加し、発行された id を返す。 */
export const post: Operation = async (req, res) => {
    const ruleApiModel = container.get<IRuleApiModel>('IRuleApiModel');

    try {
        api.responseJSON(res, 201, {
            ruleId: await ruleApiModel.add(req.body),
        });
    } catch (err: any) {
        api.responseOperationError(res, err);
    }
};

post.apiDoc = {
    summary: 'ルール追加',
    tags: ['rules'],
    description: 'ルールを追加する',
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/AddRuleOption',
                },
            },
        },
        required: true,
    },
    responses: {
        201: {
            description: 'ルールの追加に成功した',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/AddedRule',
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
