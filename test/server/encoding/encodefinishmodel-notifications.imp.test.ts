import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const EncodeFinishModel = (
    require(join(snapshot, 'model', 'service', 'encode', 'EncodeFinishModel.js')) as {
        default: new (...args: unknown[]) => { set(): void };
    }
).default;

/**
 * EncodeFinishModel.set が encode event へ登録する通知。追加・キャンセル・失敗は client 一覧の
 * 更新を、進捗更新は進捗の更新を socket 通知へ橋渡しする。
 */
describe('EncodeFinishModel event notifications (unittest/imp)', () => {
    const makeSubject = () => {
        const handlers: Record<string, (...args: unknown[]) => void> = {};
        const encodeEvent = {
            setAddEncode: vi.fn((handler: (...args: unknown[]) => void) => (handlers.add = handler)),
            setCancelEncode: vi.fn((handler: (...args: unknown[]) => void) => (handlers.cancel = handler)),
            setErrorEncode: vi.fn((handler: (...args: unknown[]) => void) => (handlers.error = handler)),
            setUpdateEncodeProgress: vi.fn((handler: (...args: unknown[]) => void) => (handlers.progress = handler)),
        };
        const socket = { notifyClient: vi.fn(), notifyUpdateEncodeProgress: vi.fn() };
        const encodeManageModel = { setEncodeFinishModel: vi.fn() };
        const model = new EncodeFinishModel(
            { getLogger: () => ({ encode: { error: vi.fn() } }) },
            socket,
            {},
            encodeEvent,
            encodeManageModel,
        );
        model.set();
        return { encodeManageModel, handlers, model, socket };
    };

    it('[EN-SPEC-R8-2] registers itself with the encode manager and every encode event', () => {
        const { encodeManageModel, handlers, model } = makeSubject();

        expect(Object.keys(handlers).sort()).toEqual(['add', 'cancel', 'error', 'progress']);
        expect(encodeManageModel.setEncodeFinishModel).toHaveBeenCalledExactlyOnceWith(model);
    });

    it.each(['add', 'cancel'])('[EN-SPEC-R8-2] a %s event notifies clients to refresh the encode list', event => {
        const { handlers, socket } = makeSubject();

        handlers[event](5);

        expect(socket.notifyClient).toHaveBeenCalledOnce();
        expect(socket.notifyUpdateEncodeProgress).not.toHaveBeenCalled();
    });

    it('[EN-SPEC-R8-2] an error event notifies clients to refresh the encode list', () => {
        const { handlers, socket } = makeSubject();

        handlers.error();

        expect(socket.notifyClient).toHaveBeenCalledOnce();
        expect(socket.notifyUpdateEncodeProgress).not.toHaveBeenCalled();
    });

    it('[EN-SPEC-R8-2] a progress event notifies clients of the progress update only', () => {
        const { handlers, socket } = makeSubject();

        handlers.progress();

        expect(socket.notifyUpdateEncodeProgress).toHaveBeenCalledOnce();
        expect(socket.notifyClient).not.toHaveBeenCalled();
    });
});
