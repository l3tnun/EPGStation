import { Operation } from 'express-openapi';
import IRuleApiModel from '../../../api/rule/IRuleApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    const ruleApiModel = container.get<IRuleApiModel>('IRuleApiModel');

    try {
        const rule = await ruleApiModel.get(parseInt(req.params.ruleId, 10));
        if (rule !== null) {
            api.responseJSON(res, 200, rule);
        } else {
            api.responseError(res, {
                code: 404,
                message: 'Rule is not Found',
            });
        }
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ルール取得',
    tags: ['rules'],
    description: 'ルールを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRuleId',
        },
    ],
    responses: {
        200: {
            description: 'ルールを削除しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Rule',
                    },
                },
            },
        },
        404: {
            description: '指定された id の rule がない',
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

export const del: Operation = async (req, res) => {
    const ruleApiModel = container.get<IRuleApiModel>('IRuleApiModel');

    try {
        await ruleApiModel.delete(parseInt(req.params.ruleId, 10));
        api.responseJSON(res, 200, {
            code: 200,
        });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'ルール削除',
    tags: ['rules'],
    description: 'ルールを削除する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRuleId',
        },
    ],
    responses: {
        200: {
            description: 'ルールを削除しました',
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

export const put: Operation = async (req, res) => {
    const ruleApiModel = container.get<IRuleApiModel>('IRuleApiModel');

    const rule = req.body;
    rule.id = parseInt(req.params.ruleId, 10);
    try {
        await ruleApiModel.update(rule);
        api.responseJSON(res, 200, {
            code: 200,
        });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'ルール更新',
    tags: ['rules'],
    description: 'ルールを更新する',
    parameters: [
        {
            $ref: '#/components/parameters/PathRuleId',
        },
    ],
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
        200: {
            description: 'ルールの更新に成功した',
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
