import { Operation } from 'express-openapi';
import { EncodeModelInterface } from '../../../Model/Api/EncodeModel';
import factory from '../../../Model/ModelFactory';
import * as api from '../../api';

export const post: Operation = async(req, res) => {
    const encode = <EncodeModelInterface> factory.get('EncodeModel');

    try {
        await encode.cancels(req.body.ids);
        api.responseJSON(res, 200, { code: 200 });
        api.notifyClient();
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'エンコードを複数キャンセル',
    tags: ['encode'],
    description: 'ンコードを複数キャンセルする',
    parameters: [
        {
            name: 'body',
            in: 'body',
            required: true,
            schema: {
                $ref: '#/definitions/EncodingCancels',
            },
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

