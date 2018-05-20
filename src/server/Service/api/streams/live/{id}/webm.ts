import { Operation } from 'express-openapi';
import { StreamsModelInterface } from '../../../../../Model/Api/StreamsModel';
import factory from '../../../../../Model/ModelFactory';
import { Stream } from '../../../../../Model/Service/Stream/Stream';
import * as api from '../../../../api';

export const get: Operation = async(req, res) => {
    const streams = <StreamsModelInterface> factory.get('StreamsModel');
    let stream: Stream | null = null;
    let isClosed: boolean = false;

    const stop = async() => {
        if (stream === null) { return; }
        await stream.stop()
        .catch(() => {});
    };

    // 接続切断時
    req.on('close', async() => {
        isClosed = true;
        stop();
    });

    try {
        // stream 取得
        const info = await streams.getWebMLive(req.params.id, req.query.mode);
        stream = info.stream;
        const encChild = info.stream.getEncChild();

        if (isClosed) {
            await stop();

            return;
        }

        res.setHeader('Content-Type', 'video/webm');
        res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.header('Expires', '-1');
        res.header('Pragma', 'no-cache');
        res.status(200);

        if (encChild !== null) {
            encChild.stdout.pipe(res);

            // enc コマンド終了時
            encChild.on('exit', async() => {
                await stop();
                res.end();
            });

            // enc コマンドエラー時
            encChild.on('error', async() => {
                await stop();
                res.end();
            });
        } else {
            // stream 生成に失敗
            throw new Error('CreatetWebMLiveStreamChildError');
        }
    } catch (err) {
        await stop();

        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'webm ライブ配信',
    tags: ['streams'],
    description: 'webm ライブ配信をする',
    parameters: [
        {
            name: 'id',
            in: 'path',
            description: 'channel id',
            required: true,
            type: 'integer',
        },
        {
            name: 'mode',
            in: 'query',
            description: 'encode mode',
            required: true,
            type: 'integer',
        },
    ],
    produces: ['video/webm'],
    responses: {
        200: {
            description: 'webm ストリーム',
        },
        default: {
            description: '予期しないエラー',
            schema: {
                $ref: '#/definitions/Error',
            },
        },
    },
};

