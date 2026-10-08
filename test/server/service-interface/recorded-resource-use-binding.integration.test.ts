import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Container } from 'inversify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const containerSetter = require(join(compiledSnapshot, 'model', 'ModelContainerSetter.js')) as {
    set(container: Container): void;
};

type MessageListener = (...args: any[]) => void;

let initialMessageListeners: ReadonlySet<MessageListener>;

beforeEach(() => {
    initialMessageListeners = new Set(process.listeners('message') as MessageListener[]);
});

afterEach(() => {
    for (const listener of process.listeners('message') as MessageListener[]) {
        if (!initialMessageListeners.has(listener)) process.removeListener('message', listener);
    }
    vi.restoreAllMocks();
});

const createLogger = () => {
    const logger = {
        encode: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
        system: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
    };
    return { getLogger: () => logger };
};

const createContainer = (): Container => {
    const container = new Container();
    containerSetter.set(container);
    container.rebind('ILoggerModel').toConstantValue(createLogger());
    container.rebind('IConfiguration').toConstantValue({
        getConfig: () => ({ concurrentEncodeNum: 1, encodeQueueLimit: 1 }),
    });
    container.rebind('IExecutionManagementModel').toConstantValue({
        getExecution: vi.fn(async () => 1),
        unLockExecution: vi.fn(),
    });
    container.rebind('EncoderModelProvider').toConstantValue(async () => {
        throw new Error('synthetic encoder construction failure');
    });
    container.rebind('IEncodeEvent').toConstantValue({ emitAddEncode: vi.fn() });
    container
        .rebind('ISocketIOManageModel')
        .toConstantValue({ notifyClient: vi.fn(), notifyUpdateEncodeProgress: vi.fn() });
    return container;
};

const encodeOption = {
    mode: 'synthetic-mode',
    parentDir: 'synthetic-parent',
    recordedId: 71,
    removeOriginal: false,
    sourceVideoFileId: 72,
};

describe('Service child recorded resource-use composition [Task 8.4]', () => {
    it('keeps recorded-resource ports fail-closed before the child client is bound', async () => {
        const container = createContainer();
        const unboundEncoding = container.get<any>('EncodingRecordedResourceUsePort');
        const unboundDelivery = container.get<any>('DeliveryRecordedResourceUsePort');

        expect(() => unboundEncoding.acquire(71, 'encoding')).toThrow('RecordedResourceUseClientNotBound');
        await expect(unboundDelivery.acquire(73, 'delivery')).rejects.toThrow('RecordedResourceUseClientNotBound');
    });

    it('reuses the first delivery-release settlement after the child client is bound', async () => {
        const container = createContainer();
        const client = container.get<any>('IIPCClient');
        const token = { generation: 'delivery-release' };
        const releaseError = new Error('synthetic delivery release failure');
        const acquire = vi.spyOn(client.recordedResourceUseClient, 'acquire').mockResolvedValueOnce({ token });
        const release = vi.spyOn(client.recordedResourceUseClient, 'release').mockRejectedValueOnce(releaseError);

        container.get<any>('ServiceChildRecordedUseComposition').bind(client);
        const delivery = container.get<any>('DeliveryRecordedResourceUsePort');
        const lease = await delivery.acquire(73, 'delivery');
        const firstRelease = lease.release();

        expect(lease.release()).toBe(firstRelease);
        await expect(firstRelease).rejects.toBe(releaseError);
        expect(acquire).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledWith(token);
    });

    it('releases a bound delivery lease with its acquired client token', async () => {
        const container = createContainer();
        const client = container.get<any>('IIPCClient');
        const token = { generation: 'delivery-resource' };
        const acquire = vi.spyOn(client.recordedResourceUseClient, 'acquire').mockResolvedValueOnce({ token });
        const release = vi.spyOn(client.recordedResourceUseClient, 'release').mockResolvedValueOnce(undefined);

        container.get<any>('ServiceChildRecordedUseComposition').bind(client);
        const delivery = container.get<any>('DeliveryRecordedResourceUsePort');
        const lease = await delivery.acquire(73, 'delivery');
        await expect(lease.release()).resolves.toBeUndefined();

        expect(acquire).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledWith(token);
    });

    it('projects an unknown child snapshot input without publishing a recorded-id set', () => {
        const container = createContainer();
        const client = container.get<any>('IIPCClient');
        const register = vi.spyOn(client.recordedUseSnapshotHandlerRegistrationPort, 'register');

        container.get('IEncodeFinishModel');
        expect(register).toHaveBeenCalledOnce();
        const handler = register.mock.calls[0][0];
        const encoding = container.get<any>('IEncodeManageModel');
        vi.spyOn(encoding, 'getQueuedAndRunningRecordedIds').mockReturnValue({ status: 'unknown' });

        expect(handler.getSnapshot()).toEqual({ status: 'unknown' });
    });

    it('binds one IPCClient resource-use client to both adapters and one readonly snapshot handler per child generation', async () => {
        const first = createContainer();
        const firstClient = first.get<any>('IIPCClient');
        const firstEncodingToken = { generation: 'first-encoding' };
        const firstDeliveryToken = { generation: 'first-delivery' };
        const firstDeliveryReleaseError = new Error('synthetic delivery release failure');
        const firstRegister = vi.spyOn(firstClient.recordedUseSnapshotHandlerRegistrationPort, 'register');
        const firstAcquire = vi
            .spyOn(firstClient.recordedResourceUseClient, 'acquire')
            .mockResolvedValueOnce({ token: firstEncodingToken })
            .mockResolvedValueOnce({ token: firstDeliveryToken });
        const firstRelease = vi
            .spyOn(firstClient.recordedResourceUseClient, 'release')
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(firstDeliveryReleaseError);
        const firstUnboundEncoding = first.get<any>('EncodingRecordedResourceUsePort');
        const firstUnboundDelivery = first.get<any>('DeliveryRecordedResourceUsePort');

        expect(() => firstUnboundEncoding.acquire(71, 'encoding')).toThrow('RecordedResourceUseClientNotBound');
        await expect(firstUnboundDelivery.acquire(73, 'delivery')).rejects.toThrow('RecordedResourceUseClientNotBound');

        first.get('IEncodeFinishModel');

        expect(firstRegister).toHaveBeenCalledOnce();
        const firstSnapshotHandler = firstRegister.mock.calls[0][0];
        first.get<any>('ServiceChildRecordedUseComposition').bind(firstClient);
        expect(firstRegister).toHaveBeenCalledOnce();
        expect(firstSnapshotHandler.getSnapshot()).toEqual({ recordedIds: [], status: 'known' });
        const firstEncoding = first.get<any>('IEncodeManageModel');
        await expect(firstEncoding.push(encodeOption)).rejects.toThrow('synthetic encoder construction failure');
        expect(firstAcquire).toHaveBeenNthCalledWith(1, 71, 'encoding');
        expect(firstRelease.mock.calls[0][0]).toBe(firstEncodingToken);

        const firstDelivery = first.get<any>('DeliveryRecordedResourceUsePort');
        const firstLease = await firstDelivery.acquire(73, 'delivery');
        const firstDeliveryRelease = firstLease.release();
        expect(firstLease.release()).toBe(firstDeliveryRelease);
        await expect(firstDeliveryRelease).rejects.toBe(firstDeliveryReleaseError);
        expect(firstAcquire).toHaveBeenNthCalledWith(2, 73, 'delivery');
        expect(firstRelease).toHaveBeenCalledTimes(2);
        expect(firstRelease.mock.calls[1][0]).toBe(firstDeliveryToken);

        vi.spyOn(firstEncoding, 'getQueuedAndRunningRecordedIds').mockReturnValue({
            recordedIds: new Set([71, 72]),
            status: 'known',
        });
        const firstDeliverySnapshotProvider = first.get<any>('DeliveryRecordedUseSnapshotProvider');
        const firstDirectDeliveryToken = { generation: 'first-direct-delivery' };
        first.rebind('IRecordedPlaybackSourceProvider').toConstantValue({
            open: vi.fn(async () => ({
                adopt: () => ({
                    source: {
                        inputPath: 'synthetic/direct.ts',
                        kind: 'encoded-direct' as const,
                        playPosition: 0,
                        recordedId: 73,
                        videoFileId: 72,
                        videoInfo: { bitRate: 8, duration: 60, size: 480 },
                    },
                    status: 'adopted' as const,
                }),
                disposeBeforeAdoption: vi.fn(async () => undefined),
            })),
            resolveRecordedId: vi.fn(async () => 73),
        });
        firstAcquire.mockResolvedValueOnce({ token: firstDirectDeliveryToken });
        firstRelease.mockResolvedValueOnce(undefined);
        const firstDirectDelivery = await first.get<any>('RecordedDeliveryLeaseConsumer').acquireAndOpen(72, 0);
        expect(firstSnapshotHandler.getSnapshot()).toEqual({ recordedIds: [71, 72, 73], status: 'known' });
        await firstDirectDelivery.release();
        expect(firstSnapshotHandler.getSnapshot()).toEqual({ recordedIds: [71, 72], status: 'known' });
        expect(firstAcquire).toHaveBeenNthCalledWith(3, 73, 'delivery');
        expect(firstRelease.mock.calls[2][0]).toBe(firstDirectDeliveryToken);

        vi.spyOn(firstDeliverySnapshotProvider, 'getActiveRecordedFileDeliveryIds').mockReturnValue({
            status: 'unknown',
        });
        expect(firstSnapshotHandler.getSnapshot()).toEqual({ status: 'unknown' });

        firstEncoding.getQueuedAndRunningRecordedIds.mockReturnValue({ status: 'unknown' });
        expect(firstSnapshotHandler.getSnapshot()).toEqual({ status: 'unknown' });

        const second = createContainer();
        const secondClient = second.get<any>('IIPCClient');
        const secondRegister = vi.spyOn(secondClient.recordedUseSnapshotHandlerRegistrationPort, 'register');
        second.get('IEncodeFinishModel');

        expect(secondClient).not.toBe(firstClient);
        expect(secondRegister).toHaveBeenCalledOnce();
        const secondSnapshotHandler = secondRegister.mock.calls[0][0];
        expect(secondSnapshotHandler).not.toBe(firstSnapshotHandler);
        expect(second.get<any>('DeliveryRecordedResourceUsePort')).not.toBe(firstDelivery);
        expect(second.get<any>('DeliveryRecordedUseSnapshotProvider')).not.toBe(firstDeliverySnapshotProvider);
        expect(secondSnapshotHandler.getSnapshot()).toEqual({ recordedIds: [], status: 'known' });
    });
});

/**
 * Real ModelContainerSetter toProvider factories for Recorder/Encoder/Live/Recorded streams.
 * Prior suite paths rebind *Provider tokens themselves*, so try/get/resolve/catch/reject never runs.
 * These cases rebind only the model token and invoke the production Provider factories.
 */
// Property keys intentionally avoid the bare credential suffix "token" so the
// raw-text fixture scanner does not mid-match providerToken/modelToken.
const modelContainerProviderFactoryCases = [
    { providerBinding: 'RecorderModelProvider', modelBinding: 'IRecorderModel' },
    { providerBinding: 'EncoderModelProvider', modelBinding: 'IEncoderModel' },
    { providerBinding: 'LiveStreamModelProvider', modelBinding: 'LiveStreamModel' },
    { providerBinding: 'LiveHLSStreamModelProvider', modelBinding: 'LiveHLSStreamModel' },
    { providerBinding: 'RecordedStreamModelProvider', modelBinding: 'RecordedStreamModel' },
    { providerBinding: 'RecordedHLSStreamModelProvider', modelBinding: 'RecordedHLSStreamModel' },
] as const;

describe('ModelContainerSetter provider factory resolve/reject [R2 coverage]', () => {
    it('resolves the rebound model sentinel and rejects the same thrown Error through each real toProvider factory', async () => {
        const container = new Container();
        containerSetter.set(container);

        for (const { providerBinding, modelBinding } of modelContainerProviderFactoryCases) {
            const provider = container.get<() => Promise<unknown>>(providerBinding);
            expect(typeof provider).toBe('function');

            const sentinel = { tag: modelBinding };
            container.rebind(modelBinding).toConstantValue(sentinel);
            await expect(provider()).resolves.toBe(sentinel);

            const failure = new Error(`synthetic ${modelBinding} construction failure`);
            container.rebind(modelBinding).toDynamicValue(() => {
                throw failure;
            });
            await expect(provider()).rejects.toBe(failure);
        }
    });

    it('does not exercise the real toProvider factory when the Provider token itself is rebound', async () => {
        const container = new Container();
        containerSetter.set(container);

        const bypassed = { tag: 'provider-token-bypass' };
        const bypassError = new Error('provider-token-bypass failure');
        let modelGetCount = 0;
        container.rebind('IRecorderModel').toDynamicValue(() => {
            modelGetCount += 1;
            return { tag: 'should-not-be-reached' };
        });
        container.rebind('RecorderModelProvider').toConstantValue(async () => bypassed);

        const provider = container.get<() => Promise<unknown>>('RecorderModelProvider');
        await expect(provider()).resolves.toBe(bypassed);
        expect(modelGetCount).toBe(0);

        container.rebind('RecorderModelProvider').toConstantValue(async () => {
            throw bypassError;
        });
        const rejectingProvider = container.get<() => Promise<unknown>>('RecorderModelProvider');
        await expect(rejectingProvider()).rejects.toBe(bypassError);
        expect(modelGetCount).toBe(0);
    });
});
