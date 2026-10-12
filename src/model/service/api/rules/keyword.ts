import { Operation } from 'express-openapi';
import type * as apid from '../../../../../api.js';
import IRuleApiModel from '../../../api/rule/IRuleApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';

/**
 * `GET /rules/keyword` ハンドラ。query の offset / limit / keyword から検索条件を組み立て、
 * `IRuleApiModel#searchKeyword` でキーワード検索したルール一覧を返す（`rules.ts` の `get` とは
 * 検索対象・呼び出す method が異なる）。
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
        if (typeof req.query.keyword === 'string') {
            option.keyword = req.query.keyword;
        }

        api.responseJSON(res, 200, {
            items: await ruleApiModel.searchKeyword(option),
        });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ルールをキーワード検索',
    tags: ['rules'],
    description: 'ルールをキーワード検索する',
    parameters: [
        {
            $ref: '#/components/parameters/Offset',
        },
        {
            $ref: '#/components/parameters/Limit',
        },
        {
            $ref: '#/components/parameters/QueryKeyword',
        },
    ],
    responses: {
        200: {
            description: 'ルールをキーワード検索結果を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/RuleKeywordInfo',
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

/**
 * `POST /rules/keyword` ハンドラ。`req.body`をそのまま`IRuleApiModel#add`へ渡してルールを
 * 新規追加し、追加された`ruleId`を返す（`rules.ts`の`post`と同じ追加処理を、この経路からも呼べる
 * ようにしたもの）。
 */
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
