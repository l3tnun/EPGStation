import { Operation } from 'express-openapi';
import * as api from '../../../api';
import factory from '../../../../Model/ModelFactory';
import { RecordedModelInterface } from '../../../../Model/Api/RecordedModel';

export const get: Operation = async (req, res) => {
    let recordeds = <RecordedModelInterface>(factory.get('RecordedModel'));

    try {
        let filePath = await recordeds.getThumbnailPath(req.params.id);
        api.responseFile(req, res, filePath, 'image/jpeg');
    } catch(err) {
        if(err.message === RecordedModelInterface.NotFoundRecordedThumbnailError) {
            api.responseError(res, { code: 404,  message: 'Recorded Thumbnail is not Found' });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

get.apiDoc = {
    summary: '録画済みファイルのサムネイルを取得',
    tags: ['recorded'],
    description: '録画済みファイルのサムネイルを取得する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'recorded id',
            required: true,
            type: 'integer'
        },
    ],
    produces: [
        "image/jpg"
    ],
    responses: {
        200: {
            description: 'ok'
        },
        404: {
            description: 'Not found'
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error'
            }
        }
    }
};

