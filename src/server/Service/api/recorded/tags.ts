import { Operation } from 'express-openapi';
import * as api from '../../api';
import factory from '../../../Model/ModelFactory';
import { RecordedModelInterface } from '../../../Model/Api/RecordedModel';

export const get: Operation = async (_req, res) => {
    let recordeds = <RecordedModelInterface>(factory.get('RecordedModel'));

    try {
        let result = await recordeds.getGenreTags();
        api.responseJSON(res, 200, result);
    } catch(err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画のタグを取得',
    tags: ['recorded'],
    description: '録画のタグを取得する',
    responses: {
        200: {
            description: '録画のタグを取得しました',
            schema: {
                $ref: '#/definitions/RecordedTags'
            }
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error'
            }
        }
    }
};

