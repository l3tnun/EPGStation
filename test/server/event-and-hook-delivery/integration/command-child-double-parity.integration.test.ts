import { spawn, type ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { DeferredCommandChild } from '../external-command-test-harness';

/*
 * hook command の子 process の偽物（DeferredCommandChild）が、本物の ChildProcess と同じ event・exitCode を
 * 見せることを確かめる。ExternalCommandManageModel は `exit`・`error` の 2 event と `exitCode` だけを読む。
 */

interface Observation {
    readonly events: Array<{ event: string; args: unknown[]; exitCode: number | null }>;
}

const observe = (child: { on: ChildProcess['on']; exitCode: number | null }, events: string[]): Observation => {
    const observation: Observation = { events: [] };
    for (const event of events) {
        child.on(event, (...args: unknown[]) => {
            observation.events.push({
                event,
                args: args.map(value => (value instanceof Error ? (value as NodeJS.ErrnoException).code : value)),
                exitCode: child.exitCode,
            });
        });
    }
    return observation;
};

describe('hook command child double parity', () => {
    it('[EH-DOUBLE-PARITY-CHILD] reports a nonzero exit as exit(code, null) with exitCode already set, like a real child', async () => {
        const real = spawn(process.execPath, ['-e', 'process.exit(17)'], { stdio: 'ignore' });
        const realObservation = observe(real, ['exit', 'error']);
        await new Promise(resolve => real.once('close', resolve));

        const double = new DeferredCommandChild(9_001);
        const doubleObservation = observe(double as unknown as ChildProcess, ['exit', 'error']);
        double.emitExit(17);

        expect(realObservation.events).toEqual([{ event: 'exit', args: [17, null], exitCode: 17 }]);
        expect(doubleObservation.events).toEqual(realObservation.events);
    });

    it('[EH-DOUBLE-PARITY-CHILD] reports a spawn failure as error only, with a negative errno in exitCode and no exit event', async () => {
        const real = spawn('/nonexistent-hook-command-for-parity', [], { stdio: 'ignore' });
        const realObservation = observe(real, ['exit', 'error']);
        await new Promise(resolve => real.once('close', resolve));

        const double = new DeferredCommandChild(9_002);
        const doubleObservation = observe(double as unknown as ChildProcess, ['exit', 'error']);
        double.emitError(Object.assign(new Error('spawn failed'), { code: 'ENOENT' }), { spawnFailure: true });

        expect(realObservation.events).toEqual([{ event: 'error', args: ['ENOENT'], exitCode: -2 }]);
        expect(doubleObservation.events).toEqual(realObservation.events);
    });
});
