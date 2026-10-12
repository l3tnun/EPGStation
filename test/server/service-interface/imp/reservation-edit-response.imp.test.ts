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

const editRequest = { body: { allowEndLack: true }, params: { reserveId: '3' } };

const putHandler = (): Handler =>
    (require(compiled('model', 'service', 'api', 'reserves', '{reserveId}.js')) as Record<string, Handler>).put;

/**
 * 編集の対象ではない予約（自動予約と Rule 由来の番組リレー予約）の編集要求は、要求の形は正しく対象の予約の種類による
 * 拒否なので、内部失敗ではなく HTTP 409 で返す。拒否はメッセージ `ReservationIsNotEditable` で伝わるため、IPC を越えても
 * 判別できる。
 */
describe('not editable reservation response (unittest/imp)', () => {
    it('[SI-4.7] responseOperationError answers 409 with the existing error body for ReservationIsNotEditable', () => {
        const { responseOperationError } = require(compiled('model', 'service', 'api.js')) as {
            responseOperationError(response: unknown, error: Error): unknown;
        };
        const response = makeResponse();

        expect(responseOperationError(response, new Error('ReservationIsNotEditable'))).toBe(response);

        expect(response.status).toHaveBeenCalledExactlyOnceWith(409);
        expect(response.json).toHaveBeenCalledExactlyOnceWith({
            code: 409,
            errors: 'ReservationIsNotEditable',
            message: 'Conflict',
        });
    });

    it('[SI-4.7] PUT /reserves/{reserveId} answers 409 when the owner rejects a reservation that is not editable', async () => {
        const edit = vi.fn().mockRejectedValue(new Error('ReservationIsNotEditable'));
        const get = vi.spyOn(modelContainer, 'get').mockReturnValue({ edit });
        const response = makeResponse();
        try {
            await putHandler()(editRequest, response);

            expect(get).toHaveBeenCalledExactlyOnceWith('IReserveApiModel');
            expect(edit).toHaveBeenCalledExactlyOnceWith(3, { allowEndLack: true });
            expect(response.status).toHaveBeenCalledExactlyOnceWith(409);
            expect(response.json).toHaveBeenCalledExactlyOnceWith({
                code: 409,
                errors: 'ReservationIsNotEditable',
                message: 'Conflict',
            });
        } finally {
            get.mockRestore();
        }
    });

    it('[SI-4.7] documents the 409 response of PUT /reserves/{reserveId} with the existing error body', () => {
        const put = putHandler() as Handler & { apiDoc: { responses: Record<string, unknown> } };

        expect(Object.keys(put.apiDoc.responses)).toEqual(['201', '409', 'default']);
        expect(put.apiDoc.responses[409]).toEqual({
            description: '編集の対象ではない予約（自動予約とルール由来の番組リレー予約）は編集できない',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        });
    });

    it.each(['ReservationEditError', 'ReservationIsNotFound'])(
        '[SI-4.7] PUT /reserves/{reserveId} keeps answering 500 for %s',
        async message => {
            const get = vi
                .spyOn(modelContainer, 'get')
                .mockReturnValue({ edit: vi.fn().mockRejectedValue(new Error(message)) });
            const response = makeResponse();
            try {
                await putHandler()(editRequest, response);

                expect(response.status).toHaveBeenCalledExactlyOnceWith(500);
                expect(response.json).toHaveBeenCalledExactlyOnceWith({
                    code: 500,
                    errors: message,
                    message: 'Internal Server Error',
                });
            } finally {
                get.mockRestore();
            }
        },
    );
});
