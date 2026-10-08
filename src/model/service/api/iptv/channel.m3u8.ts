import { Operation } from 'express-openapi';
import IIPTVApiModel, { IptvPublicUrlBuilder } from '../../../api/iptv/IIPTVApiModel.js';
import IConfiguration from '../../../IConfiguration.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';
import { completeIptvDocumentRequest } from '../../../api/iptv/IptvDocumentRequestGuard.js';

/**
 * `GET /iptv/channel.m3u8` ハンドラ。`completeIptvDocumentRequest`（timeout・応答close監視付き、
 * `src/model/api/iptv/IptvDocumentRequestGuard.ts`参照）の下で`IIPTVApiModel#getChannelList`を実行する。
 * channel logo / ライブM2TSの公開URLは、request の host（`config.yml`の`subDirectory`を
 * 考慮）とscheme（http/https）からこのハンドラが組み立てて`publicUrls`として渡す。
 */
export const get: Operation = (req, res) =>
    completeIptvDocumentRequest(res, {
        execute: async () => {
            const host = req.headers.host;
            if (typeof host === 'undefined') {
                throw new Error('HostIsUndefined');
            }
            const configuration = container.get<IConfiguration>('IConfiguration');
            const subDirectory = configuration.getConfig().subDirectory;
            const base = subDirectory === undefined ? host : `${host}${subDirectory}`;
            const scheme = api.isSecureProtocol(req) ? 'https' : 'http';
            const publicUrls: IptvPublicUrlBuilder = Object.freeze({
                channelLogoUrl: (channelId: number) => `${scheme}://${base}/api/channels/${channelId}/logo`,
                liveM2tsUrl: (channelId: number, mode: number) =>
                    `${scheme}://${base}/api/streams/live/${channelId}/m2ts?mode=${mode}`,
            });
            const iptvApiModel = container.get<IIPTVApiModel>('IIPTVApiModel');

            return iptvApiModel.getChannelList({
                isHalfWidth: req.query.isHalfWidth as any,
                mode: req.query.mode as any,
                publicUrls,
            });
        },
        failure: (error: any) => {
            api.responseServerError(res, error?.message);
        },
        success: result => {
            res.setHeader('Content-Type', 'application/x-mpegURL; charset="UTF-8"');
            res.status(200);
            res.end(result);
        },
    });

get.apiDoc = {
    summary: 'IPTV channel list を取得',
    tags: ['iptv'],
    description: 'IPTV channel list を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/IPTVIsHalfWidth',
        },
        {
            $ref: '#/components/parameters/StreamMode',
        },
    ],
    responses: {
        200: {
            description: 'channel list を取得しました',
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
