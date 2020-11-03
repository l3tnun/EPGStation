import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../../api/video/IVideoApiModel';
import container from '../../../../ModelContainer';
import * as api from '../../../api';

export const post: Operation = async (req, res) => {
    const videoApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    try {
        if (typeof req.headers.host === 'undefined') {
            throw new Error('HostIsUndefined');
        }

        await videoApiModel.sendToKodi(
            req.headers.host,
            api.isSecureProtocol(req),
            req.body.kodiName,
            parseInt(req.params.videoFileId, 10),
        );
        api.responseJSON(res, 200, { code: 200 });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

post.apiDoc = {
    summary: 'ビデオリンクを kodi へ送信',
    tags: ['videos'],
    description: 'ビデオリンクを kodi へ送信する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
    ],
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    $ref: '#/components/schemas/SendVideoLinkToKodiOption',
                },
            },
        },
        required: true,
    },
    responses: {
        200: {
            description: 'ビデオリンクを kodi へ送信するしました',
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
