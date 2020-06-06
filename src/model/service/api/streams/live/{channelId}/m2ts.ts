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
        result = await streamApiModel.startLiveM2TsStream({
            channelId: parseInt(req.params.channelId, 10),
            name: req.query.name as string,
        });
    } catch (err) {
        api.responseServerError(res, err.message);

        return;
    }

    if (isClosed !== false) {
        return;
    }

    res.setHeader('Content-Type', 'video/mp2t');
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
    summary: 'ライブ M2TS ストリーム',
    tags: ['streams'],
    description: 'ライブ M2TS ストリームを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathChannelId',
        },
        {
            $ref: '#/components/parameters/StreamName',
        },
    ],
    responses: {
        200: {
            description: 'ライブ M2TS ストリーム',
            content: {
                'video/mp2t': {},
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
