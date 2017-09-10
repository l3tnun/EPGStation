import { Operation } from 'express-openapi';
import * as api from '../../../api';
import factory from '../../../../Model/ModelFactory';
import { RecordedModelInterface } from '../../../../Model/Api/RecordedModel';

export const get: Operation = async (req, res) => {
    let recordeds = <RecordedModelInterface>(factory.get('RecordedModel'));

    try {
        let file = await recordeds.getFilePath(req.params.id, req.query.encodedId);
        api.responseFile(req, res, file.path, file.mime, req.query.mode === 'download');
    } catch(err) {
        if(err.message === RecordedModelInterface.NotFoundRecordedFileError) {
            api.responseError(res, { code: 404,  message: 'Recorded file is not Found' });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

get.apiDoc = {
    summary: '録画済みファイルを視聴 or ダウンロード',
    tags: ['recorded'],
    description: '録画済みファイルを視聴 or ダウンロードする',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'recorded id',
            required: true,
            type: 'integer'
        },
        {
            name: 'encodedId',
            in: 'query',
            description: 'encoded id',
            type: 'integer',
        },
        {
            name: 'mode',
            in: 'query',
            description: 'mode',
            type: 'string',
            enum: [ 'download' ]
        }
    ],
    produces: [
        'video/mpeg',
        'video/mp4',
        'video/webm',
        'application/octet-stream',
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

