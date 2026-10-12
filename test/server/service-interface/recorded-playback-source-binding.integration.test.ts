import 'reflect-metadata';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Container } from 'inversify';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

const containerSetter = require(join(compiledSnapshot, 'model', 'ModelContainerSetter.js')) as {
    set(container: Container): void;
};

const playbackSourceProviderKey = 'IRecordedPlaybackSourceProvider';
const recordedDeliveryLeaseConsumerKey = 'RecordedDeliveryLeaseConsumer';

const createContainer = (): Container => {
    const container = new Container();
    containerSetter.set(container);
    return container;
};

describe('Service child recorded playback source composition [Task 8.5]', () => {
    it('binds one generation-local playback source provider to one recorded delivery consumer', async () => {
        const first = createContainer();
        const firstFailure = new Error('synthetic provider binding failure');
        const firstProvider = {
            open: vi.fn(),
            resolveRecordedId: vi.fn(async () => {
                throw firstFailure;
            }),
        };
        first.rebind(playbackSourceProviderKey).toConstantValue(firstProvider);

        const firstConsumer = first.get<any>(recordedDeliveryLeaseConsumerKey);

        expect(first.get<any>(recordedDeliveryLeaseConsumerKey)).toBe(firstConsumer);
        await expect(firstConsumer.acquireAndOpen(71, 0)).rejects.toBe(firstFailure);
        expect(firstProvider.resolveRecordedId).toHaveBeenCalledOnce();
        expect(firstProvider.resolveRecordedId).toHaveBeenCalledWith(71);
        expect(firstProvider.open).not.toHaveBeenCalled();
    });

    it('propagates the generation-local provider failure through recorded delivery start without restoring old state', async () => {
        const first = createContainer();
        const firstFailure = new Error('synthetic first provider failure');
        const firstProvider = {
            open: vi.fn(),
            resolveRecordedId: vi.fn(async () => {
                throw firstFailure;
            }),
        };
        first.rebind(playbackSourceProviderKey).toConstantValue(firstProvider);
        const firstConsumer = first.get<any>(recordedDeliveryLeaseConsumerKey);

        await expect(firstConsumer.acquireAndOpen(71, 0)).rejects.toBe(firstFailure);
        expect(firstProvider.resolveRecordedId).toHaveBeenCalledOnce();
        expect(firstProvider.resolveRecordedId).toHaveBeenCalledWith(71);
        expect(firstProvider.open).not.toHaveBeenCalled();

        const second = createContainer();
        const secondFailure = new Error('synthetic second provider failure');
        const secondProvider = {
            open: vi.fn(),
            resolveRecordedId: vi.fn(async () => {
                throw secondFailure;
            }),
        };
        second.rebind(playbackSourceProviderKey).toConstantValue(secondProvider);
        const secondConsumer = second.get<any>(recordedDeliveryLeaseConsumerKey);

        await expect(secondConsumer.acquireAndOpen(72, 0)).rejects.toBe(secondFailure);
        expect(secondConsumer).not.toBe(firstConsumer);
        expect(firstProvider.resolveRecordedId).toHaveBeenCalledOnce();
        expect(firstProvider.open).not.toHaveBeenCalled();
        expect(secondProvider.resolveRecordedId).toHaveBeenCalledOnce();
        expect(secondProvider.resolveRecordedId).toHaveBeenCalledWith(72);
        expect(secondProvider.open).not.toHaveBeenCalled();
    });
});
