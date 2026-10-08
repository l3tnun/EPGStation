import { Operation } from 'express-openapi';
import IVideoApiModel from '../../../../api/video/IVideoApiModel.js';
import container from '../../../../ModelContainer.js';
import * as api from '../../../api.js';

/**
 * `POST /videos/{videoFileId}/kodi` ハンドラ。`IVideoApiModel#sendToKodi` で、request の
 * host/scheme から組み立てたビデオリンクを指定 kodi 端末（`req.body.kodiName`）へ送る。
 */
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
            parseInt(api.pathParam(req, 'videoFileId'), 10),
        );
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
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
