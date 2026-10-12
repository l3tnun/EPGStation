import { readFileSync as readSourceFile } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { deferred, load, loadTool, makeDependencies, v1Backup, versionlessBackup, withProcess } from './_harness';

const ConnectionCheckModel = load<new (...args: any[]) => any>('model', 'ConnectionCheckModel.js');
const Util = load<Record<string, any>>('util', 'Util.js');

describe('management database lifecycle characterization', () => {
    it.each(['MT-5.1', 'MT-5.3'])('[%s] probes immediately and sleeps 1000ms only after failures', async () => {
        const checkConnection = vi
            .fn()
            .mockRejectedValueOnce(new Error('one'))
            .mockRejectedValueOnce(new Error('two'))
            .mockResolvedValue(undefined);
        const sleep = vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);
        const checker = new ConnectionCheckModel(
            { getLogger: () => ({ system: { info: vi.fn() } }) },
            {},
            { checkConnection },
        );
        try {
            await checker.checkDB();
            expect(checkConnection).toHaveBeenCalledTimes(3);
            expect(sleep.mock.calls).toEqual([[1000], [1000]]);
        } finally {
            sleep.mockRestore();
        }
    });

    it('[pending DB probe] adds no timeout or second probe while one probe is pending', async () => {
        let settle!: () => void;
        const checkConnection = vi.fn(
            () =>
                new Promise<void>(resolve => {
                    settle = resolve;
                }),
        );
        const sleep = vi.spyOn(Util, 'sleep').mockResolvedValue(undefined);
        const checker = new ConnectionCheckModel(
            { getLogger: () => ({ system: { info: vi.fn() } }) },
            {},
            { checkConnection },
        );
        try {
            const pending = checker.checkDB();
            await Promise.resolve();
            expect(checkConnection).toHaveBeenCalledOnce();
            expect(sleep).not.toHaveBeenCalled();
            settle();
            await pending;
        } finally {
            sleep.mockRestore();
        }
    });

    it('[MT-5.3] keeps the selected operation and finish behind a long-pending DB probe', async () => {
        const gate = deferred();
        const harness = makeDependencies({ IConnectionCheckModel: { checkDB: vi.fn(() => gate.promise) } });
        const writeFileSync = vi.fn();
        const Tool = await loadTool('DBTools.js', harness.container, { readFileSync: vi.fn(), writeFileSync });
        const tool = await withProcess(['-m', 'backup', '-o', 'synthetic-output'], () => new Tool());
        const running = withProcess([], () => tool.run());
        await Promise.resolve();
        expect(writeFileSync).not.toHaveBeenCalled();
        expect(harness.dependencies.IDBOperator.closeConnection).not.toHaveBeenCalled();
        expect(harness.ledger).toEqual(['log:--- run ---']);
        gate.resolve();
        await expect(running).rejects.toEqual(expect.objectContaining({ code: 0 }));
    });

    // 管理 command が通常稼働中の process を止めたり、signal や管理用の lock を使ったりしないことを、
    // 呼び出しの記録 (process の停止・signal・listener 登録と、container から取り出した名前) と、
    // compiled の source に呼び出しが無いことで見る。
    const managementToolDependencyNames = [
        'ILoggerModel',
        'IConfiguration',
        'IConnectionCheckModel',
        'IDBOperator',
        'IDropLogFileDB',
        'IRecordedDB',
        'IRecordedHistoryDB',
        'IRecordedTagDB',
        'IReserveDB',
        'IRuleDB',
        'IThumbnailDB',
        'IVideoFileDB',
    ];

    it.each([
        ['backup', 'DBTools.js', ['-m', 'backup', '-o', 'synthetic-output'], '{}'],
        ['restore', 'DBTools.js', ['-m', 'restore', '-o', 'synthetic-input'], JSON.stringify(versionlessBackup())],
        ['v1 migration', 'V1MigrationTool.js', ['-i', 'synthetic-v1-input'], JSON.stringify(v1Backup())],
    ] as const)(
        '[MT-5.2] does not stop the service, send a signal, or take a management lock during %s',
        async (_label, filename, argv, input) => {
            const harness = makeDependencies();
            const readFileSync = vi.fn(() => input);
            const Tool = await loadTool(filename, harness.container, { readFileSync, writeFileSync: vi.fn() });
            const processCalls = [
                vi.spyOn(process, 'kill'),
                vi.spyOn(process, 'on'),
                vi.spyOn(process, 'once'),
                vi.spyOn(process, 'addListener'),
            ];
            try {
                const tool = await withProcess(argv, () => new Tool());
                await expect(withProcess([], () => tool.run())).rejects.toEqual(expect.objectContaining({ code: 0 }));

                for (const spy of processCalls) expect(spy).not.toHaveBeenCalled();
                const requested = harness.container.get.mock.calls.map(([name]) => name);
                expect(requested.length).toBeGreaterThan(0);
                for (const name of requested) expect(managementToolDependencyNames).toContain(name);
                expect(harness.dependencies.IConnectionCheckModel.checkDB).toHaveBeenCalledOnce();
                expect(harness.dependencies.IDBOperator.closeConnection).toHaveBeenCalledOnce();
            } finally {
                for (const spy of processCalls) spy.mockRestore();
            }
        },
    );

    it.each(['DBTools.js', 'V1MigrationTool.js'])(
        '[MT-5.2] %s contains no call that stops a process, sends a signal, or registers a process listener',
        filename => {
            const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
            const source = readSourceFile(join(snapshot, filename), 'utf8');

            expect(source).not.toMatch(/\bprocess\s*\.\s*(?:kill|on|once|addListener|prependListener|emit)\s*\(/);
            expect(source).not.toMatch(/ExecutionManagement|IPCServer|IPCClient|ProcessUtil|lockfile|child_process/i);
        },
    );

    it.each(['MT-5.4', 'MT-5.5'])('[%s] closes before finish and success exit', async () => {
        const harness = makeDependencies();
        const Tool = await loadTool('DBTools.js', harness.container, { readFileSync: vi.fn(), writeFileSync: vi.fn() });
        const tool = await withProcess(['-m', 'backup', '-o', 'synthetic-output'], () => new Tool());
        await expect(withProcess([], () => tool.run())).rejects.toEqual(expect.objectContaining({ code: 0 }));
        const close = harness.ledger.indexOf('close-db');
        const finish = harness.ledger.indexOf('log:--- finish ---');
        expect(close).toBeGreaterThanOrEqual(0);
        expect(finish).toBeGreaterThanOrEqual(0);
        expect(close).toBeLessThan(finish);
    });

    it('[MT-5.6] awaits close failure and does not log finish or exit successfully', async () => {
        const close = deferred();
        const harness = makeDependencies({ IDBOperator: { closeConnection: vi.fn(() => close.promise) } });
        const Tool = await loadTool('DBTools.js', harness.container, { readFileSync: vi.fn(), writeFileSync: vi.fn() });
        const tool = await withProcess(['-m', 'backup', '-o', 'synthetic-output'], () => new Tool());
        const running = withProcess([], () => tool.run());
        await Promise.resolve();
        expect(harness.log.system.info).not.toHaveBeenCalledWith('--- finish ---');
        const failure = new Error('synthetic close failure');
        close.reject(failure);
        await expect(running).rejects.toBe(failure);
        expect(harness.log.system.info).not.toHaveBeenCalledWith('--- finish ---');
    });
});
