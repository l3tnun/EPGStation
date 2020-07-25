import { Operation } from 'express-openapi';
import IStreamApiModel, { StreamResponse } from '../../../../../api/stream/IStreamApiModel';
import container from '../../../../../ModelContainer';
import * as api from '../../../../api';

export const get: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    let isClosed: boolean = false;
    let result: StreamResponse;
    let keepTimer: NodeJS.Timer;

    const stop = async () => {
        clearInterval(keepTimer);

        if (typeof result === 'undefined') {
            return;
        }

        await streamApiModel.stop(result.streamId, true);
    };

    req.on('close', async () => {
        isClosed = true;
        await stop();
    });

    try {
        result = await streamApiModel.startRecordedWebMStream({
            videoFileId: parseInt(req.params.videoFileId, 10),
            playPosition: parseInt(req.query.ss as string, 10),
            mode: parseInt(req.query.mode as string, 10),
        });
        keepTimer = setInterval(() => {
            streamApiModel.keep(result.streamId);
        }, 10 * 1000);
    } catch (err) {
        api.responseServerError(res, err.message);

        return;
    }

    if (isClosed !== false) {
        await stop();

        return;
    }

    res.setHeader('Content-Type', 'video/webm');
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
    summary: '録画 WebM ストリーム',
    tags: ['streams'],
    description: '録画 WebM ストリームを取得する',
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
            description: '録画 WebM ストリーム',
            content: {
                'video/webm': {},
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
