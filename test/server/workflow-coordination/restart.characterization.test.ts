import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');

const fixture = join(process.cwd(), 'test/server/fixtures/workflow-coordination/restart-child.cjs');

const runChild = async (mode: 'fresh-emit' | 'no-emit' | 'pending') => {
    const result = await executeFile(process.execPath, [fixture, mode], {
        env: { ...process.env, EPGSTATION_SERVER_COMPILED_SNAPSHOT: snapshot },
        timeout: 5_000,
    });
    expect(result.stderr).toBe('');
    return result.stdout.trim().split('\n').filter(Boolean);
};

describe('workflow restart characterization', () => {
    it('[PRIMARY WC-7.5][WC-7.5] does not restore an in-flight callback or replay its event in a fresh process', async () => {
        await expect(runChild('pending')).resolves.toEqual(['callback:pending', 'emit:return']);
        await expect(runChild('no-emit')).resolves.toEqual(['process:idle']);
        await expect(runChild('fresh-emit')).resolves.toEqual(['callback:fresh', 'emit:return']);
    });
});
