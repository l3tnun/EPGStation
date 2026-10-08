import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Container } from 'inversify';
import { describe, expect, it, vi } from 'vitest';
import { flushImmediate, makeChild } from '../process-messaging/_harness';
import { makeLogger, OperatorEncodeEvent } from './_harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');

const info = { mode: 'synthetic-mode', recordedId: 71, videoFileId: null };
const loadBinding = (): new (...args: any[]) => any =>
    (
        require(join(snapshot, 'model', 'event', 'OperatorEncodeEventBinding.js')) as {
            default: new (...args: any[]) => any;
        }
    ).default;
const loadContainerSetter = (): ((container: Container) => void) =>
    (require(join(snapshot, 'model', 'ModelContainerSetter.js')) as { set(container: Container): void }).set;

describe('Operator encode completion provider registration', () => {
    it('forwards one exact PM payload through the provider to one operator event', () => {
        const logger = makeLogger();
        const provider = new OperatorEncodeEvent({ getLogger: () => logger });
        const listener = vi.fn();
        provider.setFinishEncode(listener);

        expect(provider.accept(info)).toBeUndefined();

        expect(listener.mock.calls).toEqual([[info]]);
        expect(listener.mock.calls[0][0]).toBe(info);
        expect(logger.system.error).not.toHaveBeenCalled();
    });

    it('registers the same provider once per argument-free setup call without automatic dedupe', () => {
        const Binding = loadBinding();
        const register = vi.fn();
        const provider = { accept: vi.fn() };
        const binding = new Binding({ register }, provider);

        expect(binding.setup()).toBeUndefined();
        expect(register.mock.calls).toEqual([[provider]]);

        expect(binding.setup()).toBeUndefined();
        expect(register.mock.calls).toEqual([[provider], [provider]]);
    });

    it('uses the existing DI seam to register and dispatch through the same provider exactly once', async () => {
        const container = new Container();
        loadContainerSetter()(container);
        const logger = makeLogger();
        container.rebind('ILoggerModel').toConstantValue({ getLogger: () => logger });
        container.rebind('IConfiguration').toConstantValue({
            getConfig: () => ({ uploadTempDir: 'synthetic-provider-registration-upload-fixture' }),
        });
        for (const token of [
            'IReservationManageModel',
            'IRecordedManageModel',
            'IRecordedTagManadeModel',
            'IRecordingManageModel',
            'IRuleManageModel',
            'IThumbnailManageModel',
        ]) {
            container.rebind(token).toConstantValue({});
        }

        const ipc = container.get<any>('IIPCServer');
        const provider = container.get<any>('IOperatorEncodeEvent');
        const binding = container.get<any>('OperatorEncodeEventBinding');
        const register = vi.spyOn(ipc.encodeCompletionSinkRegistrationPort, 'register');
        const accept = vi.spyOn(provider, 'accept');
        const listener = vi.fn();
        const child = makeChild();
        provider.setFinishEncode(listener);

        expect(binding.setup()).toBeUndefined();
        ipc.register(child);
        child.emit('message', {
            args: { info },
            func: 'emitFinishEncode',
            id: 311,
            model: 'encodeEvent',
        });
        await flushImmediate();

        expect(register).toHaveBeenCalledOnce();
        expect(register.mock.calls[0][0]).toBe(provider);
        expect(accept.mock.calls).toEqual([[info]]);
        expect(accept.mock.calls[0][0]).toBe(info);
        expect(listener.mock.calls).toEqual([[info]]);
        expect(listener.mock.calls[0][0]).toBe(info);
        expect(child.send.mock.calls).toEqual([[{ id: 311, result: undefined }]]);
        expect(logger.system.error).not.toHaveBeenCalled();
    });
});
