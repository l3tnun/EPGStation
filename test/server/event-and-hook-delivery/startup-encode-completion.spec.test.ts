import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Container } from 'inversify';
import { describe, expect, it, vi } from 'vitest';
import { flushImmediate, makeChild } from '../process-messaging/_harness';
import { makeLogger } from './_harness';

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');

const info = { mode: 'synthetic-mode', recordedId: 72, videoFileId: null };
const loadContainerSetter = (): ((container: Container) => void) =>
    (require(join(snapshot, 'model', 'ModelContainerSetter.js')) as { set(container: Container): void }).set;

describe('Operator startup path for encode completion', () => {
    it('[supporting provider registration] delivers an encode completion notice to the external command model after IEventSetter.set() alone', async () => {
        const container = new Container();
        loadContainerSetter()(container);
        const logger = makeLogger();
        container.rebind('ILoggerModel').toConstantValue({ getLogger: () => logger });
        container.rebind('IConfiguration').toConstantValue({
            getConfig: () => ({ uploadTempDir: 'synthetic-startup-encode-completion-upload-fixture' }),
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
        const externalCommand = {
            addEncodingFinishCmd: vi.fn(),
        };
        container.rebind('IExternalCommandManageModel').toConstantValue(externalCommand);

        // Same order as the operator startup: resolve IEventSetter and call set() once.
        // OperatorEncodeEventBinding.setup() is deliberately not called here.
        const ipc = container.get<any>('IIPCServer');
        const register = vi.spyOn(ipc.encodeCompletionSinkRegistrationPort, 'register');
        container.get<any>('IEventSetter').set();

        const child = makeChild();
        ipc.register(child);
        child.emit('message', {
            args: { info },
            func: 'emitFinishEncode',
            id: 705,
            model: 'encodeEvent',
        });
        await flushImmediate();

        expect(register).toHaveBeenCalledOnce();
        expect(child.send.mock.calls).toEqual([[{ id: 705, result: undefined }]]);
        expect(externalCommand.addEncodingFinishCmd.mock.calls).toEqual([[info]]);
        expect(logger.system.error).not.toHaveBeenCalled();
    });
});
