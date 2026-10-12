// Must stay the very first import in this file: it registers a Node loader hook that has to be in
// place before the EPGUpdateExecutorManageModel module is loaded for the first time.
import { childProcessOverrides, resetChildProcessOverrides } from './child-process-override-hook';

import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');
const EPGUpdateExecutorManageModel = (
    require(join(compiledSnapshot, 'model', 'epgUpdater', 'EPGUpdateExecutorManageModel.js')) as any
).default;

const logger = () => ({ system: { debug: vi.fn(), error: vi.fn(), fatal: vi.fn(), info: vi.fn() } });

const makeChild = (pid: number) =>
    Object.assign(new EventEmitter(), {
        kill: vi.fn(),
        pid,
        stderr: new PassThrough(),
        stdout: new PassThrough(),
    });

const disposeChild = (child: ReturnType<typeof makeChild>): void => {
    child.removeAllListeners();
    child.stdout.removeAllListeners();
    child.stderr.removeAllListeners();
    child.stdout.destroy();
    child.stderr.destroy();
};

afterEach(() => {
    resetChildProcessOverrides();
    vi.restoreAllMocks();
});

describe('EPG update executor supervision of a superseded child', () => {
    it.each([
        ['monitored process', 'activeExecutor'],
        ['monitoring generation', 'activeGeneration'],
    ])('[PG-X-ipc] ignores an updated message once the %s is no longer the active one', async (_label, field) => {
        const child = makeChild(41_001);
        childProcessOverrides.spawn = vi.fn().mockReturnValue(child as any);
        const emitUpdated = vi.fn();
        const model = new EPGUpdateExecutorManageModel({ getLogger: logger }, { emitUpdated });

        try {
            await model.execute();
            const original = model[field];
            model[field] = {};
            child.emit('message', { msg: 'updated' });
            expect(emitUpdated).not.toHaveBeenCalled();

            model[field] = original;
            child.emit('message', { msg: 'updated' });
            expect(emitUpdated).toHaveBeenCalledTimes(1);
        } finally {
            disposeChild(child);
        }
    });

    it.each([
        ['monitored process', 'activeExecutor', 'exit'],
        ['monitored process', 'activeExecutor', 'close'],
        ['monitored process', 'activeExecutor', 'disconnect'],
        ['monitored process', 'activeExecutor', 'error'],
        ['monitoring generation', 'activeGeneration', 'exit'],
        ['monitoring generation', 'activeGeneration', 'close'],
        ['monitoring generation', 'activeGeneration', 'disconnect'],
        ['monitoring generation', 'activeGeneration', 'error'],
    ])(
        '[PG-X-ipc] does not restart the child on a terminal event once the %s (%s) is no longer the active one: %s',
        async (_label, field, event) => {
            const child = makeChild(41_002);
            const spawn = vi.fn().mockReturnValue(child as any);
            childProcessOverrides.spawn = spawn;
            const model = new EPGUpdateExecutorManageModel({ getLogger: logger }, { emitUpdated: vi.fn() });

            try {
                await model.execute();
                model[field] = {};
                child.emit(event, new Error('synthetic-superseded-child'));
                await new Promise<void>(resolve => setImmediate(resolve));

                expect(spawn).toHaveBeenCalledOnce();
                expect(child.kill).not.toHaveBeenCalled();
            } finally {
                disposeChild(child);
            }
        },
    );
});
