import { Operation } from 'express-openapi';
import { RecordedModelInterface } from '../../../../Model/Api/RecordedModel';
import factory from '../../../../Model/ModelFactory';
import * as api from '../../../api';

export const get: Operation = async(req, res) => {
    const recordeds = <RecordedModelInterface> factory.get('RecordedModel');

    try {
        const file = await recordeds.getFilePath(req.params.id, req.query.encodedId);
        api.responseFile(req, res, file.path, file.mime, req.query.mode === 'download');
    } catch (err) {
        if (err.message === RecordedModelInterface.NotFoundRecordedFileError) {
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
            type: 'integer',
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
            enum: ['download'],
        },
    ],
    produces: [
        'video/mpeg',
        'video/mp4',
        'video/webm',
        'application/octet-stream',
    ],
    responses: {
        200: {
            description: 'ok',
        },
        404: {
            description: 'Not found',
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
    const recordeds = <RecordedModelInterface> factory.get('RecordedModel');

    try {
        await recordeds.deleteRecorded(req.params.id, req.query.encodedId);
        api.responseJSON(res, 200, { code: 200 });
        api.notifyClient();
    } catch (err) {
        switch (err.message) {
            case RecordedModelInterface.NotFoundRecordedIdError:
                api.responseError(res, { code: 404,  message: 'id is not found' });
                break;
            case RecordedModelInterface.NotFoundRecordedFileError:
                api.responseError(res, { code: 404,  message: 'file is not found' });
                break;
            case RecordedModelInterface.RecordedIsStreamingNowError:
                api.responseError(res, { code: 423,  message: 'file is locked' });
                break;
            case RecordedModelInterface.FileIsLockedError:
                api.responseError(res, { code: 423,  message: 'file is locked' });
                break;
            default:
                api.responseServerError(res, err.message);
                break;
        }
    }
};

del.apiDoc = {
    summary: '録画を個別削除',
    tags: ['recorded'],
    description: '録画を個別削除する',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'recorded id',
            required: true,
            type: 'integer',
        },
        {
            name: 'encodedId',
            in: 'query',
            description: 'encoded id',
            type: 'integer',
        },
    ],
    responses: {
        200: {
            description: '録画を個別削除しました',
        },
        404: {
            description: 'Not found',
        },
        423: {
            description: 'file is locked',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

