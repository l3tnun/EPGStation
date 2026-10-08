import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    healthyTunerHandler,
    isProcessAlive,
    openDescriptorCount,
    reserveUnusedPort,
    residentSetKilobytes,
    sleep,
    startOperator,
    startTunerStub,
    waitFor,
    type OperatorHandle,
    type TunerStub,
} from '../harness/real-operator';

/**
 * Child supervision of the compiled Operator as a real process. The Service and EPG children are real
 * child processes on real IPC channels and real pipes; only their entry scripts are replaced so that each
 * test controls what the child does. Wall-clock limits only bound a hung run.
 */

const operators: OperatorHandle[] = [];
const stubs: TunerStub[] = [];

afterEach(async () => {
    await Promise.all(operators.splice(0).map(operator => operator.stop()));
    await Promise.all(stubs.splice(0).map(stub => stub.close()));
});

const idleService = 'setInterval(() => undefined, 1_000_000);\n';

const launch = async (epgExecutorSource: string): Promise<OperatorHandle> => {
    const stub = await startTunerStub(healthyTunerHandler([{ index: 0, name: 'synthetic-tuner-0', types: ['GR'] }]));
    stubs.push(stub);
    const operator = await startOperator({
        epgExecutorSource,
        serviceExecutorSource: idleService,
        servicePort: await reserveUnusedPort(),
        tunerPort: stub.port,
    });
    operators.push(operator);
    return operator;
};

const markerLines = async (operator: OperatorHandle, name: string): Promise<string[]> => {
    try {
        return (await readFile(join(operator.root, name), 'utf8')).split('\n').filter(line => line !== '');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
};

/** A child that records every SIGINT it receives; the first generation optionally disconnects from the IPC channel. */
const sigintRecorder = (behaviour: 'disconnect' | 'exit' | 'idle'): string => `
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
const root = new URL('../../../', import.meta.url);
const generationFile = new URL('epg-generation', root);
const first = !existsSync(generationFile);
writeFileSync(generationFile, 'seen');
process.on('SIGINT', () => {
    appendFileSync(new URL('sigint-marker.log', root), 'SIGINT ' + process.pid + '\\n');
    process.exit(0);
});
${behaviour === 'disconnect' ? "if (first) setTimeout(() => process.disconnect(), 300);" : ''}
${behaviour === 'exit' ? "if (first) setTimeout(() => process.exit(3), 300);" : ''}
setInterval(() => undefined, 1_000_000);
`;

describe('[AR-8.5] a disconnected EPG child is sent SIGINT before the restart (real process)', () => {
    it('delivers exactly one SIGINT to the child that disconnected, then starts a new child', async () => {
        const operator = await launch(sigintRecorder('disconnect'));

        await waitFor(() => operator.epgPids().length >= 2, 'the replacement EPG child', () => operator.stdout());
        const [firstPid] = operator.epgPids();
        await waitFor(
            async () => (await markerLines(operator, 'sigint-marker.log')).length >= 1,
            'the SIGINT marker',
            () => operator.stdout(),
        );
        // Give a duplicated signal time to arrive before counting.
        await sleep(1_000);
        expect(await markerLines(operator, 'sigint-marker.log')).toEqual([`SIGINT ${firstPid}`]);
        expect(operator.epgPids()).toHaveLength(2);
        expect(await operator.readSystemLog()).toContain('epg updater is disconnected');
        expect(isProcessAlive(firstPid)).toBe(false);
    }, 60_000);

    it.each([
        { label: 'exits by itself', behaviour: 'exit' as const },
        { label: 'is killed by SIGKILL', behaviour: 'idle' as const },
    ])('sends no SIGINT when the child $label, and still starts a new child', async ({ behaviour }) => {
        const operator = await launch(sigintRecorder(behaviour));

        await waitFor(() => operator.epgPids().length >= 1, 'the first EPG child', () => operator.stdout());
        if (behaviour === 'idle') {
            const [pid] = operator.epgPids();
            await waitFor(async () => (await markerLines(operator, 'epg-generation')).length > 0, 'the child start', () => operator.stdout());
            process.kill(pid, 'SIGKILL');
        }
        await waitFor(() => operator.epgPids().length >= 2, 'the replacement EPG child', () => operator.stdout());
        await sleep(1_000);
        expect(await markerLines(operator, 'sigint-marker.log')).toEqual([]);
        expect(operator.epgPids()).toHaveLength(2);
        // A child that dies closes its IPC channel first, so the one restart is recorded once, whichever event led it.
        expect((await operator.readSystemLog()).match(/epg updater is|epg update is/gu)).toHaveLength(1);
    }, 60_000);
});

const killAndAwaitReplacement = async (
    operator: OperatorHandle,
    pidsOf: () => number[],
    description: string,
): Promise<void> => {
    const before = pidsOf();
    process.kill(before[before.length - 1], 'SIGKILL');
    await waitFor(() => pidsOf().length === before.length + 1, description, () => operator.stdout());
};

describe('[AR-8.6] restarts have no fixed upper bound and leak nothing (real process)', () => {
    it(
        'replaces a SIGKILLed Service child and EPG child 200 times each without growing the Operator descriptors',
        async () => {
            const operator = await launch("setInterval(() => undefined, 1_000_000);\n");
            await waitFor(
                () => operator.servicePids().length === 1 && operator.epgPids().length === 1,
                'both children',
                () => operator.stdout(),
            );
            const operatorPid = operator.runSession.child.pid!;
            const restartBoth = async (round: number): Promise<void> => {
                await killAndAwaitReplacement(operator, () => operator.servicePids(), `Service restart ${round}`);
                await killAndAwaitReplacement(operator, () => operator.epgPids(), `EPG restart ${round}`);
            };

            // Let the first generations settle (lazy descriptors, log files) before taking the baseline.
            for (let round = 1; round <= 5; round += 1) await restartBoth(round);
            const baseline = await openDescriptorCount(operatorPid);
            for (let round = 6; round <= 200; round += 1) await restartBoth(round);

            expect(operator.servicePids()).toHaveLength(201);
            expect(operator.epgPids()).toHaveLength(201);
            expect(new Set(operator.servicePids()).size).toBe(201);
            expect(new Set(operator.epgPids()).size).toBe(201);
            expect(await openDescriptorCount(operatorPid)).toBeLessThanOrEqual(baseline + 2);
            expect(operator.isAlive()).toBe(true);
            // The previous generation is gone each time, never accumulated.
            for (const pid of [...operator.servicePids().slice(0, -1), ...operator.epgPids().slice(0, -1)]) {
                expect(isProcessAlive(pid)).toBe(false);
            }
        },
        180_000,
    );
});

/** First generation: writes about 12 MB to stdout and stderr, recording progress in a marker file. Later generations idle. */
const chattyFirstGeneration = `
import { existsSync, writeFileSync } from 'node:fs';
const root = new URL('../../../', import.meta.url);
const generationFile = new URL('epg-generation', root);
const first = !existsSync(generationFile);
writeFileSync(generationFile, 'seen');
const flushed = stream => chunk => new Promise(resolve => stream.write(chunk, resolve));
if (first) {
    const chunk = 'x'.repeat(64 * 1024);
    const chunks = 96;
    for (let index = 1; index <= chunks; index += 1) {
        // The write callbacks fire only when the Operator drains the pipes.
        await flushed(process.stdout)(chunk);
        await flushed(process.stderr)(chunk);
        writeFileSync(new URL('chatty-progress.log', root), String(index));
    }
    writeFileSync(new URL('chatty-progress.log', root), 'done');
}
setInterval(() => undefined, 1_000_000);
`;

describe('[AR-8.7] piped child output is read so that the child never blocks (real process)', () => {
    it(
        'lets the EPG child write 12 MB to stdout and stderr, then restarts it 50 times without growing the Operator',
        async () => {
            const operator = await launch(chattyFirstGeneration);

            // A child whose stdout or stderr pipe was never read would stall at the 64 KiB pipe buffer.
            await waitFor(
                async () => (await readFile(join(operator.root, 'chatty-progress.log'), 'utf8').catch(() => '')) === 'done',
                'the child finishing 12 MB of output',
                () => operator.stdout(),
            );
            const operatorPid = operator.runSession.child.pid!;
            const rssBefore = await residentSetKilobytes(operatorPid);
            expect(operator.epgPids()).toHaveLength(1);

            for (let round = 1; round <= 5; round += 1) {
                await killAndAwaitReplacement(operator, () => operator.epgPids(), `EPG restart ${round}`);
            }
            const baseline = await openDescriptorCount(operatorPid);
            for (let round = 6; round <= 50; round += 1) {
                await killAndAwaitReplacement(operator, () => operator.epgPids(), `EPG restart ${round}`);
            }

            expect(await openDescriptorCount(operatorPid)).toBeLessThanOrEqual(baseline + 2);
            // 12 MB went through the pipes; draining must not retain it in the Operator.
            expect((await residentSetKilobytes(operatorPid)) - rssBefore).toBeLessThan(60 * 1024);
            expect(operator.isAlive()).toBe(true);
        },
        120_000,
    );
});
