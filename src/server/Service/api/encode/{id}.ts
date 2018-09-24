import { Operation } from 'express-openapi';
import { EncodeModelInterface } from '../../../Model/Api/EncodeModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const del: Operation = async(req, res) => {
    const encode = <EncodeModelInterface> factory.get('EncodeModel');

    try {
        await encode.cancel(req.params.id);
        api.responseJSON(res, 200, { code: 200 });
        api.notifyClient();
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'エンコードを削除',
    tags: ['encode'],
    description: 'エンコードを削除する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'encode id',
            required: true,
            type: 'string',
        },
    ],
    responses: {
        200: {
            description: 'エンコードをキャンセルしました',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

