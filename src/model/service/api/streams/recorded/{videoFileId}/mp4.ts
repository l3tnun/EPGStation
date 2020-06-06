import { Operation } from 'express-openapi';
import IStreamApiModel, { StreamResponse } from '../../../../../api/stream/IStreamApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';

export const get: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    let isClosed: boolean = false;
    let result: StreamResponse;

    const stop = async () => {
        if (typeof result === 'undefined') {
            return;
        }

        streamApiModel.stop(result.streamId);
    };

    req.on('close', async () => {
        isClosed = true;
        await stop();
    });

    try {
        result = await streamApiModel.startRecordedMp4Stream({
            videoFileId: parseInt(req.params.videoFileId, 10),
            name: req.query.name as string,
            playPosition: parseInt(req.query.ss as string, 10),
        });
    } catch (err) {
        api.responseServerError(res, err.message);

        return;
    }

    if (isClosed !== false) {
        return;
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.status(200);

    result.stream.on('close', () => {
        res.end();
    });
    result.stream.on('exit', () => {
        res.end();
    });
    result.stream.on('error', () => {
        res.end();
    });

    result.stream.pipe(res);
};

get.apiDoc = {
    summary: '録画 mp4 ストリーム',
    tags: ['streams'],
    description: '録画 mp4 ストリームを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathVideoFileId',
        },
        {
            $ref: '#/components/parameters/StreamName',
        },
        {
            $ref: '#/components/parameters/StreamPlayPosition',
        },
    ],
    responses: {
        200: {
            description: '録画 mp4 ストリーム',
            content: {
                'video/mp4': {},
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
