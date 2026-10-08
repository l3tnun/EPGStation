import { Operation } from 'express-openapi';
import IIPTVApiModel from '../../../api/iptv/IIPTVApiModel.js';
import container from '../../../ModelContainer.js';
import * as api from '../../api.js';
import { completeIptvDocumentRequest } from '../../../api/iptv/IptvDocumentRequestGuard.js';

/**
 * `GET /iptv/epg.xml` ハンドラ。`completeIptvDocumentRequest`（timeout・応答close監視付き、
 * `src/model/api/iptv/IptvDocumentRequestGuard.ts`参照）の下でXMLTV形式のEPGを生成する。
 * `IIPTVApiModel#getEpgForRequest`（任意実装、`requestContext`で途中打ち切りを検知できる）
 * があればそちらを使い、無ければ`getEpg`にfall backする。
 */
export const get: Operation = (req, res) =>
    completeIptvDocumentRequest(res, {
        execute: async requestContext => {
            const iptvApiModel = container.get<IIPTVApiModel>('IIPTVApiModel');
            const days: number = req.query.days as any;
            const isHalfWidth = req.query.isHalfWidth as any;
            if (iptvApiModel.getEpgForRequest !== undefined) {
                return iptvApiModel.getEpgForRequest(days, isHalfWidth, requestContext);
            }
            return iptvApiModel.getEpg(days, isHalfWidth);
        },
        failure: (error: any) => {
            api.responseServerError(res, error?.message);
        },
        success: result => {
            res.setHeader('Content-Type', 'application/xml; charset="UTF-8"');
            res.status(200);
            res.end(result);
        },
    });

get.apiDoc = {
    summary: 'IPTV epg を取得',
    tags: ['iptv'],
    description: 'IPTV epg を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/IPTVIsHalfWidth',
        },
        {
            $ref: '#/components/parameters/IPTVDays',
        },
    ],
    responses: {
        200: {
            description: 'epg を取得しました',
            content: {
                'application/xml': {},
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
