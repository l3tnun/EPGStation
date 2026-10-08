import { describe, expect, it, vi } from 'vitest';

import { compiled, modelContainer, require } from '../_harness';

const makeResponse = () => {
    const response: Record<string, any> = {};
    response.status = vi.fn(() => response);
    response.header = vi.fn(() => response);
    response.json = vi.fn(() => response);
    return response;
};

type Handler = (request: unknown, response: unknown) => Promise<void>;

const routes: ReadonlyArray<readonly [string, string[], string, string, Record<string, unknown>]> = [
    ['POST /reserves', ['reserves.js'], 'post', 'IReserveApiModel', { body: {} }],
    ['PUT /reserves/{reserveId}', ['reserves', '{reserveId}.js'], 'put', 'IReserveApiModel', { body: {}, params: { reserveId: '3' } }],
    ['POST /rules', ['rules.js'], 'post', 'IRuleApiModel', { body: {} }],
    ['POST /rules/keyword', ['rules', 'keyword.js'], 'post', 'IRuleApiModel', { body: {} }],
    ['PUT /rules/{ruleId}', ['rules', '{ruleId}.js'], 'put', 'IRuleApiModel', { body: {}, params: { ruleId: '4' } }],
    ['POST /encode', ['encode.js'], 'post', 'IEncodeApiModel', { body: {} }],
];

const rejectingModel = (error: Error) => ({
    add: vi.fn().mockRejectedValue(error),
    edit: vi.fn().mockRejectedValue(error),
    update: vi.fn().mockRejectedValue(error),
});

/**
 * 保存先内ディレクトリが録画保存先の外を指す要求の拒否は、内部失敗ではなく入力エラーとして HTTP 400 で返す。
 * 担当機能の拒否はメッセージ `InvalidSubDirectory` で伝わるため、IPC を越えても判別できる。
 */
describe('sub directory rejection response (unittest/imp)', () => {
    it('[SI-4.1] responseOperationError answers 400 with the existing error body for InvalidSubDirectory', () => {
        const { responseOperationError } = require(compiled('model', 'service', 'api.js')) as {
            responseOperationError(response: unknown, error: Error): unknown;
        };
        const response = makeResponse();

        expect(responseOperationError(response, new Error('InvalidSubDirectory'))).toBe(response);

        expect(response.status).toHaveBeenCalledExactlyOnceWith(400);
        expect(response.json).toHaveBeenCalledExactlyOnceWith({
            code: 400,
            errors: 'InvalidSubDirectory',
            message: 'Bad Request',
        });
    });

    it('[SI-4.7] responseOperationError answers the existing 500 body for any other failure', () => {
        const { responseOperationError } = require(compiled('model', 'service', 'api.js')) as {
            responseOperationError(response: unknown, error: Error): unknown;
        };
        const response = makeResponse();

        responseOperationError(response, new Error('AddRuleError'));

        expect(response.status).toHaveBeenCalledExactlyOnceWith(500);
        expect(response.json).toHaveBeenCalledExactlyOnceWith({
            code: 500,
            errors: 'AddRuleError',
            message: 'Internal Server Error',
        });
    });

    it.each(routes)('[SI-4.1] %s answers 400 when the owner rejects InvalidSubDirectory', async (_route, file, method, key, request) => {
        const handler = (require(compiled('model', 'service', 'api', ...file)) as Record<string, Handler>)[method];
        const get = vi.spyOn(modelContainer, 'get').mockReturnValue(rejectingModel(new Error('InvalidSubDirectory')));
        const response = makeResponse();
        try {
            await handler(request, response);

            expect(get).toHaveBeenCalledExactlyOnceWith(key);
            expect(response.status).toHaveBeenCalledExactlyOnceWith(400);
            expect(response.json).toHaveBeenCalledExactlyOnceWith({
                code: 400,
                errors: 'InvalidSubDirectory',
                message: 'Bad Request',
            });
        } finally {
            get.mockRestore();
        }
    });

    it.each(routes)('[SI-4.7] %s keeps answering 500 for other owner failures', async (_route, file, method, _key, request) => {
        const handler = (require(compiled('model', 'service', 'api', ...file)) as Record<string, Handler>)[method];
        const get = vi.spyOn(modelContainer, 'get').mockReturnValue(rejectingModel(new Error('synthetic-failure')));
        const response = makeResponse();
        try {
            await handler(request, response);

            expect(response.status).toHaveBeenCalledExactlyOnceWith(500);
            expect(response.json).toHaveBeenCalledExactlyOnceWith({
                code: 500,
                errors: 'synthetic-failure',
                message: 'Internal Server Error',
            });
        } finally {
            get.mockRestore();
        }
    });
});
