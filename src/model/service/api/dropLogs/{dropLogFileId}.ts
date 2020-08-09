import { Operation } from 'express-openapi';
import IDropLogApiModel from '../../../api/dropLog/IDropLogApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const get: Operation = async (req, res) => {
    const dropLogApiModel = container.get<IDropLogApiModel>('IDropLogApiModel');

    try {
        const filePath = await dropLogApiModel.getIdFilePath(parseInt(req.params.dropLogFileId, 10));

        if (filePath === null) {
            api.responseError(res, {
                code: 404,
                message: 'drop log file is not Found',
            });
        } else {
            api.responseFile(req, res, filePath, 'text/plain', false);
        }
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ドロップログ',
    tags: ['dropLogs'],
    description: 'ドロップログを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathDropLogFileId',
        },
    ],
    responses: {
        200: {
            description: 'ドロップログを取得しました',
            content: {
                'text/plain': {},
            },
        },
        404: {
            description: 'Not Found',
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};
