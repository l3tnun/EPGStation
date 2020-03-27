import { Operation } from 'express-openapi';
import { RulesModelInterface } from '../../../Model/Api/RulesModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const get: Operation = async(req, res) => {
    const rules = <RulesModelInterface> factory.get('RulesModel');

    try {
        const result = await rules.getId(parseInt(req.params.id, 10));
        api.responseJSON(res, 200, result);
    } catch (err) {
        if (err.message === RulesModelInterface.NotFoundRuleIdError) {
            api.responseError(res, { code: 404,  message: 'Rule Id is not Found' });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

get.apiDoc = {
    summary: 'rule を id 取得',
    tags: ['rules'],
    description: 'rule を id 取得する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'rule id',
            required: true,
            type: 'integer',
        },
    ],
    responses: {
        200: {
            description: 'rule を id 取得しました',
            schema: {
                $ref: '#/definitions/Rule',
            },
        },
        404: {
            description: '指定された id の rule がない',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

export const put: Operation = async(req, res) => {
    const rules = <RulesModelInterface> factory.get('RulesModel');

    try {
        await rules.updateRule(parseInt(req.params.id, 10), req.body);
        api.responseJSON(res, 200, { code: 200 });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'rule を更新',
    tags: ['rules'],
    description: 'rule を更新する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'rule id',
            required: true,
            type: 'integer',
        },
        {
            in: 'body',
            name: 'body',
            description: '必要な項目の組み合わせが複雑なので Model を確認すること',
            required: true,
            schema: {
                $ref: '#/definitions/AddRule',
            },
        },
    ],
    responses: {
        200: {
            description: 'rule を更新しました',
        },
        400: {
            description: '入力に間違えがある場合',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

export const del: Operation = async(req, res) => {
    const rules = <RulesModelInterface> factory.get('RulesModel');

    try {
        await rules.deleteRule(
            parseInt(req.params.id, 10),
            typeof req.query.delete === 'undefined' ? false : req.query.delete,
        );
        api.responseJSON(res, 200, { code: 200 });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'rule を削除',
    tags: ['rules'],
    description: 'rule を削除する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'rule id',
            required: true,
            type: 'integer',
        },
        {
            name: 'delete',
            description: '録画ファイルを削除するか',
            in: 'query',
            type: 'boolean',
            default: false,
        },
    ],
    responses: {
        200: {
            description: 'rule を削除しました',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

