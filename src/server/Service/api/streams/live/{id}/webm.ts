import { Operation } from 'express-openapi';
import { StreamsModelInterface } from '../../../../../Model/Api/StreamsModel';
import factory from '../../../../../Model/ModelFactory';
import * as api from '../../../../api';

export const get: Operation = async(req, res) => {
    const streams = <StreamsModelInterface> factory.get('StreamsModel');

    try {
        // stream 取得
        const info = await streams.getWebMLive(req.params.id, req.query.mode);
        const encChild = info.stream.getEncChild();

        res.setHeader('Content-Type', 'video/webm');
        res.status(200);

        // 接続切断時
        req.on('close', async() => {
            await streams.stop(info.streamNumber);
        });

        if (encChild !== null) {
            encChild.stdout.pipe(res);

            // enc コマンド終了時
            encChild.on('exit', async() => {
                res.end();
            });

            // enc コマンドエラー時
            encChild.on('error', async() => {
                res.end();
            });
        } else {
            // stream 生成に失敗
            throw new Error('CreatetWebMLiveStreamChildError');
        }
    } catch (err) {
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

