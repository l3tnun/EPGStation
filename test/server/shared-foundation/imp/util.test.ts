import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required to resolve server foundation evidence');
}

async function loadUtil(): Promise<{ sleep: (msec: number) => Promise<void> }> {
    const moduleUrl = pathToFileURL(join(compiledSnapshot!, 'util', 'Util.js'));
    const { default: Util } = (await import(moduleUrl.href)) as { default: { sleep: (msec: number) => Promise<void> } };
    return Util;
}

describe('[IMP-CHAR-SF-2] Util.sleep time boundary and settlement', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('stays pending immediately before its boundary', async () => {
        vi.useFakeTimers();
        const Util = await loadUtil();
        const settled = vi.fn();

        Util.sleep(1_000).then(settled);
        await vi.advanceTimersByTimeAsync(999);

        expect(settled).not.toHaveBeenCalled();
    });

    it('settles with undefined exactly at its boundary', async () => {
        vi.useFakeTimers();
        const Util = await loadUtil();

        const pending = Util.sleep(1_000);
        await vi.advanceTimersByTimeAsync(1_000);

        await expect(pending).resolves.toBeUndefined();
    });

    it('does not settle a second time after its boundary', async () => {
        vi.useFakeTimers();
        const Util = await loadUtil();
        const settled = vi.fn();

        Util.sleep(1_000).then(settled);
        await vi.advanceTimersByTimeAsync(1_000);
        await vi.advanceTimersByTimeAsync(1_000);

        expect(settled).toHaveBeenCalledOnce();
    });
});
