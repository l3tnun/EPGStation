import { Operation } from 'express-openapi';
import IStreamApiModel from '../../../../../../api/stream/IStreamApiModel.js';
import container from '../../../../../../ModelContainer.js';
import * as api from '../../../../../api.js';

/**
 * `GET /streams/live/{channelId}/m2ts/playlist` ハンドラ。`IStreamApiModel#getLiveM2TsStreamM3u8`
 * でライブM2TS配信用のm3u8プレイリストを取得する。プレイリスト内のURLに使う host / scheme を
 * request から決定する（`host` ヘッダ、`api.isSecureProtocol` によるhttps判定）。
 * 対象ストリームが存在しない場合（`null`）は404を返す。
 */
export const get: Operation = async (req, res) => {
    const streamApiModel = container.get<IStreamApiModel>('IStreamApiModel');

    try {
        if (typeof req.headers.host === 'undefined') {
            throw new Error('HostIsUndefined');
        }

        const playlist = await streamApiModel.getLiveM2TsStreamM3u8(req.headers.host, api.isSecureProtocol(req), {
            channelId: parseInt(api.pathParam(req, 'channelId'), 10),
            mode: parseInt(req.query.mode as string, 10),
        });

        if (playlist === null) {
            api.responseError(res, {
                code: 404,
                message: 'play list is not found',
            });
        } else {
            api.responsePlayList(req, res, playlist);
        }
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: 'ライブ M2TS ストリームプレイリスト',
    tags: ['streams'],
    description: 'ライブ M2TS ストリームプレイリストを取得する',
    parameters: [
        {
            $ref: '#/components/parameters/PathChannelId',
        },
        {
            $ref: '#/components/parameters/StreamMode',
        },
    ],
    responses: {
        200: {
            description: 'ライブ M2TS ストリームプレイリストを取得しました',
            content: {
                'application/x-mpegURL': {},
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
