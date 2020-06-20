import { Operation } from 'express-openapi';
import IStreamApiModel from '../../../../../api/stream/IStreamApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';

export const get: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    try {
        const streamId = await streamApiModel.startRecordedHLSStream({
            videoFileId: parseInt(req.params.videoFileId, 10),
            playPosition: parseInt(req.query.ss as string, 10),
            mode: parseInt(req.query.mode as string, 10),
        });
        api.responseJSON(res, 200, {
            streamId: streamId,
        });
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画 HLS ストリーム',
    tags: ['streams'],
    description: '録画 HLS ストリームを開始する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
        {
            $ref: '#/components/parameters/StreamPlayPosition',
        },
        {
            $ref: '#/components/parameters/StreamMode',
        },
    ],
    responses: {
        200: {
            description: '録画 HLS ストリームを開始しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/StartStreamInfo',
                    },
                },
            },
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
