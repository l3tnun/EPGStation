import { Operation } from 'express-openapi';
import { RecordedModelInterface } from '../../../../Model/Api/RecordedModel';
import factory from '../../../../Model/ModelFactory';
import * as api from '../../../api';

export const get: Operation = async(req, res) => {
    const recordeds = <RecordedModelInterface> factory.get('RecordedModel');

    try {
        const result = await recordeds.getDuration(parseInt(req.params.id, 10));
        api.responseJSON(res, 200, { duration: result });
    } catch (err) {
        if (err.message === RecordedModelInterface.NotFoundRecordedIdError) {
            api.responseError(res, { code: 404,  message: 'Recorded Id is not Found' });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

get.apiDoc = {
    summary: '録画の実際の長さを取得',
    tags: ['recorded'],
    description: '録画の実際の長さ取得する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'recorded id',
            required: true,
            type: 'integer',
        },
    ],
    responses: {
        200: {
            description: '録画の実際の長さを取得しました',
            schema: {
                $ref: '#/definitions/RecordedDurationInfo',
            },
        },
        404: {
            description: '指定された id の録画データがない',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

