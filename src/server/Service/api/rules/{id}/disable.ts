import { Operation } from 'express-openapi';
import * as api from '../../../api';
import factory from '../../../../Model/ModelFactory';
import { RulesModelInterface } from '../../../../Model/Api/RulesModel';

export const put: Operation = async (req, res) => {
    let rules = <RulesModelInterface>(factory.get('RulesModel'));

    try {
        await rules.disableRule(req.params.id);
        api.responseJSON(res, 200, { code: 200 });
    } catch(err) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'rule を無効化',
    tags: ['rules'],
    description: 'rule を無効化する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'rule id',
            required: true,
            type: 'integer'
        }
    ],
    responses: {
        200: {
            description: 'rule を無効化しました'
        },
        404: {
            description: '指定された id の rule がない場合'
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error'
            }
        }
    }
};

