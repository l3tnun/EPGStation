import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    DeferredCommandChild,
    hookFamilies,
    installSpawnStub,
    makeCommandQueueHarness,
    processStubs,
    resetCommandHarness,
    restoreSpawnStub,
    waitFor,
} from '../external-command-test-harness';

beforeAll(() => installSpawnStub());
afterEach(() => {
    resetCommandHarness();
    vi.clearAllTimers();
    vi.useRealTimers();
});
afterAll(() => restoreSpawnStub());

describe('external hook command process environment implementation', () => {
    it.each(hookFamilies.map(family => [family.label, family] as const))(
        '[EH-4.1] passes the server PATH to the %s command process',
        async (_label, family) => {
            const harness = makeCommandQueueHarness();
            const children: DeferredCommandChild[] = [];
            processStubs.spawn.mockImplementation(() => {
                const child = new DeferredCommandChild(3_000 + children.length);
                children.push(child);
                return child;
            });

            family.invoke(harness.model, family.makePayload());
            await waitFor(() => children.length === 1, `${family.label}: hook did not spawn`);

            const options = processStubs.spawn.mock.calls[0][2] as { env: Record<string, unknown> };
            expect(options.env.PATH).toBe(process.env['PATH']);
            expect(typeof options.env.PATH).toBe('string');
            children[0].emitExit(0);
            await Promise.all(harness.queueAdd.mock.results.map(result => result.value));
        },
    );

    it('[EH-4.1] settles a command whose preparation throws synchronously and releases the active slot', async () => {
        const harness = makeCommandQueueHarness();
        const failure = new Error('synthetic-synchronous-preparation-failure');

        await harness.model.startCommand('reserve-added', 'synthetic-cmd', () => {
            throw failure;
        });

        expect(harness.logger.system.error).toHaveBeenCalledWith('execute cmd error: synthetic-cmd');
        expect(harness.logger.system.error).toHaveBeenCalledWith(failure);
        expect(harness.model.activeHookCommand).toBeNull();
    });
});
