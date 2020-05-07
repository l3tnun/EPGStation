import { Operation } from 'express-openapi';
import { RecordedModelInterface } from '../../../../Model/Api/RecordedModel';
import factory from '../../../../Model/ModelFactory';
import * as api from '../../../api';

export const get: Operation = async(req, res) => {
    const recordeds = <RecordedModelInterface> factory.get('RecordedModel');

    try {
        const filePath = await recordeds.getLogPath(
            parseInt(req.params.id, 10),
            req.query.maxsize as any as number,
        );
        res.sendFile(filePath);
    } catch (err) {
        if (err.message === RecordedModelInterface.NotFoundRecordedLogError) {
            api.responseError(res, { code: 404,  message: 'Recorded Log File is not Found' });
        } else if (err.message === RecordedModelInterface.FileIsTooLarge) {
            api.responseError(res, { code: 416,  message: 'Recorded Log File is too large' });
        } else {
            api.responseServerError(res, err.message);
        }
    }
};

get.apiDoc = {
    summary: '録画済みファイルのログファイルを取得',
    tags: ['recorded'],
    description: '録画済みファイルのログファイルを取得する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'recorded id',
            required: true,
            type: 'integer',
        },
        {
            name: 'maxsize',
            in: 'query',
            description: 'ファイル最大サイズ (KByte)',
            type: 'integer',
            minimum: 1,
            default: 512,
        },
    ],
    produces: [
        'text/plain',
    ],
    responses: {
        200: {
            description: 'ok',
        },
        404: {
            description: 'Not found',
        },
        416: {
            description: 'file is too large',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

