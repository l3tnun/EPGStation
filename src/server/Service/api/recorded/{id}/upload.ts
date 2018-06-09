import { Operation } from 'express-openapi';
import { RecordedModelInterface } from '../../../../Model/Api/RecordedModel';
import factory from '../../../../Model/ModelFactory';
import * as api from '../../../api';

export const post: Operation = async(req, res) => {
    const recordeds = <RecordedModelInterface> factory.get('RecordedModel');

    try {
        if (typeof req.body.file === 'undefined') { throw new Error('FileIsNotFound'); }

        await recordeds.addExternalFile({
            recordedId: req.params.id,
            isEncoded: typeof req.body.encoded === 'undefined' ? false : req.body.encoded,
            viewName: typeof req.body.name === 'undefined' ? 'TS' : req.body.name,
            fileName: req.body.file.originalname,
            uploadPath: req.body.file.path,
            directory: req.body.directory,
        });
        api.responseJSON(res, 200, { code: 200, result: 'ok' });
        api.notifyClient();
    } catch (err) {
        api.responseServerError(res, err.message);
    }

    await api.deleteUploadFile(req.body.file);
};

post.apiDoc = {
    summary: '外部ファイル追加',
    tags: ['recorded'],
    description: '外部ファイル追加する',
    consumes: ['multipart/form-data'],
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'recorded id',
            required: true,
            type: 'integer',
        },
        {
            name: 'directory',
            in: 'formData',
            description: 'directory name',
            type: 'string',
        },
        {
            name: 'encoded',
            in: 'formData',
            description: 'encode 済みファイルか',
            type: 'boolean',
            default: false,
        },
        {
            name: 'name',
            in: 'formData',
            description: 'Web UI で表示される名前',
            type: 'string',
            default: 'TS',
        },
        {
            name: 'file',
            in: 'formData',
            type: 'file',
            description: '録画ファイル',
            required: true,
        },
    ],
    responses: {
        200: {
            description: 'ok',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

