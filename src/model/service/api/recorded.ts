import { Operation } from 'express-openapi';
import { GetRecordedOption } from '../../../../api';
import IRecordedApiModel from '../../api/recorded/IRecordedApiModel';
import container from '../../ModelContainer';
import * as api from '../api';

export const get: Operation = async (req, res) => {
    const recordedApiModel = container.get<IRecordedApiModel>('IRecordedApiModel');

    try {
        const option: GetRecordedOption = {
            isHalfWidth: (req.query.isHalfWidth as any) as boolean,
        };
        if (typeof req.query.offset === 'string') {
            option.offset = parseInt(req.query.offset, 10);
        }
        if (typeof req.query.limit === 'string') {
            option.limit = parseInt(req.query.limit, 10);
        }
        if (typeof req.query.isReverse === 'boolean') {
            option.isReverse = req.query.isReverse;
        }
        if (typeof req.query.ruleId === 'string') {
            option.ruleId = parseInt(req.query.ruleId, 10);
        }
        if (typeof req.query.channelId === 'string') {
            option.channelId = parseInt(req.query.channelId, 10);
        }
        if (typeof req.query.genre === 'string') {
            option.genre = parseInt(req.query.genre, 10);
        }
        if (typeof req.query.keyword === 'string') {
            option.keyword = req.query.keyword;
        }
        if (typeof req.query.isOnlyOriginalFile === 'boolean') {
            option.isOnlyOriginalFile = req.query.isOnlyOriginalFile;
        }

        api.responseJSON(res, 200, await recordedApiModel.gets(option));
    } catch (err) {
        api.responseServerError(res, err.message);
    }
};

get.apiDoc = {
    summary: '録画情報取得',
    tags: ['recorded'],
    description: '録画情報を取得する',
    parameters: [
        {
            $ref: '#/components/parameters/IsHalfWidth',
        },
        {
            $ref: '#/components/parameters/Offset',
        },
        {
            $ref: '#/components/parameters/Limit',
        },
        {
            $ref: '#/components/parameters/IsReverse',
        },
        {
            $ref: '#/components/parameters/QueryRuleId',
        },
        {
            $ref: '#/components/parameters/QueryChannelId',
        },
        {
            $ref: '#/components/parameters/QueryProgramGenre',
        },
        {
            $ref: '#/components/parameters/QueryKeyword',
        },
        {
            $ref: '#/components/parameters/QueryIsOnlyOriginalFile',
        },
    ],
    responses: {
        200: {
            description: '録画情報を取得しました',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Records',
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
