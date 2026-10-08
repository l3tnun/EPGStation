import { describe, expect, it, vi } from 'vitest';
import { immediateRetry, loadCompiledDefault, repositoryOperator } from '../persistence/repository-harness';
import { deferred, loadTool, makeDependencies, versionlessBackup, withProcess } from './_harness';

const mt38Stages = [
    { name: 'rule', port: 'IRuleDB', module: 'RuleDB', items: 'ruleItems' },
    { name: 'reserve', port: 'IReserveDB', module: 'ReserveDB', items: 'reserveItems' },
    { name: 'drop-log', port: 'IDropLogFileDB', module: 'DropLogFileDB', items: 'dropLogFileItems' },
    { name: 'recorded', port: 'IRecordedDB', module: 'RecordedDB', items: 'recordedItems' },
    { name: 'thumbnail', port: 'IThumbnailDB', module: 'ThumbnailDB', items: 'thumbnailItems' },
    { name: 'video-file', port: 'IVideoFileDB', module: 'VideoFileDB', items: 'videoFileItems' },
    {
        name: 'recorded-history',
        port: 'IRecordedHistoryDB',
        module: 'RecordedHistoryDB',
        items: 'recordedHistoryItems',
    },
    { name: 'recorded-tag', port: 'IRecordedTagDB', module: 'RecordedTagDB', items: 'recordedTagItems' },
] as const;

// RuleDB.restore は規則の入れ子の option を DB の行へ変換するため、規則だけ option を持たせる。
const mt38Backup = () => ({
    ...versionlessBackup(),
    ruleItems: [
        {
            id: 11,
            updateCnt: 12,
            isTimeSpecification: false,
            searchOption: { keyword: 'synthetic-rule' },
            reserveOption: { enable: true, avoidDuplicate: false, allowEndLack: true },
        },
    ],
});

type Mt38Fault = 'start' | 'delete' | 'insert' | 'commit' | 'insert-rollback' | 'release' | 'insert-release';

const mt38Faults: readonly {
    readonly fault: Mt38Fault;
    readonly rolledBack: boolean;
}[] = [
    { fault: 'start', rolledBack: false },
    { fault: 'delete', rolledBack: true },
    { fault: 'insert', rolledBack: true },
    { fault: 'commit', rolledBack: true },
    { fault: 'insert-rollback', rolledBack: true },
    { fault: 'release', rolledBack: false },
    { fault: 'insert-release', rolledBack: true },
];

// QueryRunner の fake。transaction の開始から解放までの呼び出しを events へ記録し、指定した
// failure point で本物と同じ形（transaction は commit/rollback が成功するまで active）で失敗する。
const makeMt38Runner = (fault: Mt38Fault | 'none', releaseGate?: Promise<void>) => {
    const events: string[] = [];
    let active = false;
    const errors = {
        start: new Error('synthetic-start-primary'),
        delete: new Error('synthetic-delete-primary'),
        insert: new Error('synthetic-insert-primary'),
        commit: new Error('synthetic-commit-primary'),
        rollback: new Error('synthetic-rollback-cleanup'),
        release: new Error('synthetic-release-cleanup'),
    };
    const builder = {
        delete: vi.fn(() => builder),
        from: vi.fn(() => builder),
        execute: vi.fn(async () => {
            events.push('delete');
            if (fault === 'delete') throw errors.delete;
        }),
    };
    const runner = {
        get isTransactionActive() {
            return active;
        },
        manager: {
            createQueryBuilder: vi.fn(() => builder),
            insert: vi.fn(async () => {
                events.push('insert');
                if (fault === 'insert' || fault === 'insert-rollback' || fault === 'insert-release') {
                    throw errors.insert;
                }
                return { identifiers: [{ id: 1 }] };
            }),
        },
        startTransaction: vi.fn(async () => {
            events.push('start');
            if (fault === 'start') throw errors.start;
            active = true;
        }),
        commitTransaction: vi.fn(async () => {
            events.push('commit');
            if (fault === 'commit') throw errors.commit;
            active = false;
        }),
        rollbackTransaction: vi.fn(async () => {
            events.push('rollback');
            if (fault === 'insert-rollback') throw errors.rollback;
            active = false;
        }),
        release: vi.fn(async () => {
            events.push('release-begin');
            if (releaseGate !== undefined) await releaseGate;
            events.push('release-end');
            if (fault === 'release' || fault === 'insert-release') throw errors.release;
        }),
    };
    return { errors, events, runner };
};

type Mt38Stage = (typeof mt38Stages)[number];

const prepareMt38 = async (stage: Mt38Stage, fault: Mt38Fault | 'none', releaseGate?: Promise<void>) => {
    const harness = makeDependencies();
    const fake = makeMt38Runner(fault, releaseGate);
    const Repository = loadCompiledDefault<{ restore(items: object[]): Promise<void> }>(`model/db/${stage.module}.js`);
    const repository = new Repository(
        repositoryOperator({ createQueryRunner: vi.fn(() => fake.runner) }),
        immediateRetry,
    );
    harness.dependencies[stage.port] = {
        ...harness.dependencies[stage.port],
        restore: vi.fn(async (value: object[]) => {
            harness.ledger.push(`restore:${stage.name}`);
            await repository.restore(value);
        }),
    };
    const Tool = await loadTool('DBTools.js', harness.container, {
        readFileSync: vi.fn(() => JSON.stringify(mt38Backup())),
        writeFileSync: vi.fn(),
    });
    const tool = await withProcess(['-m', 'restore', '-o', 'synthetic-input'], () => new Tool());
    return { fake, harness, tool };
};

// release を保留したまま restore を走らせ、release 完了前は結果が公開されず、完了後に
// `restore error` だけが公開されることを、rollback の有無・後続 stage の抑止とあわせて確かめる。
const verifyMt38 = async (stage: Mt38Stage, index: number, { fault, rolledBack }: (typeof mt38Faults)[number]) => {
    const gate = deferred<void>();
    const { fake, harness, tool } = await prepareMt38(stage, fault, gate.promise);
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
        let settled = false;
        // drop-log だけは DBTools が process.exit(1) で終わるため、ProcessExit として届く。
        const settlement = withProcess([], () => tool.restore()).then(
            () => {
                settled = true;
                return { code: undefined as number | undefined, error: undefined as unknown };
            },
            (reason: { code?: number }) => {
                settled = true;
                return { code: reason.code, error: reason as unknown };
            },
        );
        await vi.waitFor(() => expect(fake.events).toContain('release-begin'));
        for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
        expect(fake.events).not.toContain('release-end');
        expect(settled).toBe(false);
        expect(fake.runner.release).toHaveBeenCalledOnce();

        gate.resolve();
        const outcome = await settlement;
        expect(settled).toBe(true);
        expect(fake.events.slice(-2)).toEqual(['release-begin', 'release-end']);

        const printed = diagnostic.mock.calls.flat();
        const error = (
            stage.name === 'drop-log'
                ? printed.find(value => value instanceof Error && value.message === 'restore error')
                : outcome.error
        ) as (Error & { cause?: unknown }) | undefined;
        expect(error).toBeInstanceOf(Error);
        expect(error?.message).toBe('restore error');
        expect(error?.cause).toBeUndefined();
        if (stage.name === 'drop-log') expect(outcome.code).toBe(1);
        for (const original of Object.values(fake.errors)) expect(error).not.toBe(original);

        // active のときだけ rollback し、release は全経路で一度だけ。
        expect(fake.runner.rollbackTransaction).toHaveBeenCalledTimes(rolledBack ? 1 : 0);
        expect(fake.runner.commitTransaction).toHaveBeenCalledTimes(fault === 'commit' || fault === 'release' ? 1 : 0);
        expect(fake.runner.release).toHaveBeenCalledOnce();
        if (fault === 'start') expect(fake.events[0]).toBe('start');

        // 失敗した種類より後の種類は開始せず、前の種類だけが実行済みになる。
        for (const later of mt38Stages.slice(index + 1)) {
            expect(harness.dependencies[later.port].restore).not.toHaveBeenCalled();
        }
        for (const earlier of mt38Stages.slice(0, index)) {
            expect(harness.dependencies[earlier.port].restore).toHaveBeenCalledOnce();
        }
    } finally {
        gate.resolve();
        diagnostic.mockRestore();
    }
};

describe('management restore characterization', () => {
    it.each(['MT-3.1', 'MT-3.3', 'MT-3.6'])(
        '[%s] reads JSON after DB availability and restores eight stages in fixed order',
        async () => {
            const harness = makeDependencies();
            const readFileSync = vi.fn(() => {
                harness.ledger.push('read-file');
                return JSON.stringify(versionlessBackup());
            });
            const Tool = await loadTool('DBTools.js', harness.container, { readFileSync, writeFileSync: vi.fn() });
            const tool = await withProcess(['-m', 'restore', '-o', 'synthetic-input'], () => new Tool());
            await withProcess(['-m', 'restore', '-o', 'synthetic-input'], async () => {
                await expect(tool.run()).rejects.toEqual(expect.objectContaining({ code: 0 }));
            });
            expect(harness.ledger.indexOf('check-db')).toBeLessThan(harness.ledger.indexOf('read-file'));
            expect(harness.ledger.indexOf('read-file')).toBeLessThan(harness.ledger.indexOf('restore:rule'));
            expect(harness.ledger.filter(value => value.startsWith('restore:'))).toEqual([
                'restore:rule',
                'restore:reserve',
                'restore:drop-log',
                'restore:recorded',
                'restore:thumbnail',
                'restore:video-file',
                'restore:recorded-history',
                'restore:recorded-tag',
            ]);
            expect(readFileSync).toHaveBeenCalledWith('synthetic-input', 'utf-8');
        },
    );

    it.each([
        ['MT-3.2', 'missing file', Object.assign(new Error('synthetic missing input'), { code: 'ENOENT' })],
        ['restore input characterization', 'read failure', new Error('synthetic read failure')],
        ['restore input characterization', 'parse failure', undefined],
    ])('[%s] exits before the first mutation for %s', async (_caseName, _label, readFailure) => {
        const harness = makeDependencies();
        const readFileSync = vi.fn(() => {
            if (readFailure !== undefined) throw readFailure;
            return '{invalid';
        });
        const Tool = await loadTool('DBTools.js', harness.container, {
            readFileSync,
            writeFileSync: vi.fn(),
        });
        const tool = await withProcess(['-m', 'restore', '-o', 'synthetic-input'], () => new Tool());
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await expect(withProcess([], () => tool.restore())).rejects.toEqual(expect.objectContaining({ code: 1 }));
            expect(harness.dependencies.IRuleDB.restore).not.toHaveBeenCalled();
            expect(readFileSync).toHaveBeenCalledWith('synthetic-input', 'utf-8');
        } finally {
            error.mockRestore();
        }
    });

    it('[restore input characterization] exits before the first mutation when the backup file reads as null', async () => {
        const harness = makeDependencies();
        // readFileSync is typed `string | null`; every other failure case above throws instead, so
        // this exercises restore()'s own `file === null` guard (a real fs read with a 'utf-8'
        // encoding never actually returns null, but this class's injected readFileSync seam can).
        const readFileSync = vi.fn(() => null);
        const Tool = await loadTool('DBTools.js', harness.container, {
            readFileSync,
            writeFileSync: vi.fn(),
        });
        const tool = await withProcess(['-m', 'restore', '-o', 'synthetic-input'], () => new Tool());
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await expect(withProcess([], () => tool.restore())).rejects.toEqual(expect.objectContaining({ code: 1 }));
            expect(harness.dependencies.IRuleDB.restore).not.toHaveBeenCalled();
            expect(readFileSync).toHaveBeenCalledWith('synthetic-input', 'utf-8');
        } finally {
            error.mockRestore();
        }
    });

    it('[restore input characterization] performs no global preflight and reaches the first invalid collection stage', async () => {
        const harness = makeDependencies({
            IRuleDB: {
                restore: vi.fn(async (items: unknown) => {
                    harness.ledger.push('restore:rule:attempt');
                    if (!Array.isArray(items)) throw new TypeError('synthetic ruleItems must be an array');
                }),
            },
        });
        const document = { ...versionlessBackup(), ruleItems: null, reserveItems: [{ id: 1 }, { id: 1 }] };
        const Tool = await loadTool('DBTools.js', harness.container, {
            readFileSync: vi.fn(() => JSON.stringify(document)),
            writeFileSync: vi.fn(),
        });
        const tool = await withProcess(['-m', 'restore', '-o', 'synthetic-input'], () => new Tool());
        await expect(tool.restore()).rejects.toThrow('synthetic ruleItems must be an array');
        expect(harness.ledger).toContain('restore:rule:attempt');
        expect(harness.dependencies.IReserveDB.restore).not.toHaveBeenCalled();
    });

    it('[MT-3.7] retains prior stages and stops after the first failed stage', async () => {
        const harness = makeDependencies();
        const failure = new Error('restore error');
        harness.dependencies.IRecordedDB.restore.mockRejectedValue(failure);
        const Tool = await loadTool('DBTools.js', harness.container, {
            readFileSync: vi.fn(() => JSON.stringify(versionlessBackup())),
            writeFileSync: vi.fn(),
        });
        const tool = await withProcess(['-m', 'restore', '-o', 'synthetic-input'], () => new Tool());
        await expect(tool.restore()).rejects.toBe(failure);
        expect(harness.ledger.filter(value => value.startsWith('restore:'))).toEqual([
            'restore:rule',
            'restore:reserve',
            'restore:drop-log',
        ]);
        expect(harness.dependencies.IThumbnailDB.restore).not.toHaveBeenCalled();
    });

    it('[MT-3.4] restores metadata without changing any media file', async () => {
        const harness = makeDependencies();
        const readFileSync = vi.fn(() => JSON.stringify(versionlessBackup()));
        const writeFileSync = vi.fn();
        const copyFileSync = vi.fn();
        const renameSync = vi.fn();
        const unlinkSync = vi.fn();
        const Tool = await loadTool('DBTools.js', harness.container, {
            copyFileSync,
            readFileSync,
            renameSync,
            unlinkSync,
            writeFileSync,
        });
        const tool = await withProcess(['-m', 'restore', '-o', 'synthetic-input'], () => new Tool());

        await tool.restore();

        expect(readFileSync).toHaveBeenCalledWith('synthetic-input', 'utf-8');
        expect(copyFileSync).not.toHaveBeenCalled();
        expect(renameSync).not.toHaveBeenCalled();
        expect(unlinkSync).not.toHaveBeenCalled();
        expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('[MT-3.5] restores tag bodies without a recorded-tag relation mutation', async () => {
        const relationRestore = vi.fn();
        const harness = makeDependencies({ IRecordedTagRelationDB: { restore: relationRestore } });
        const document = { ...versionlessBackup(), recordedTagRelations: [{ recordedId: 31, tagId: 81 }] };
        const Tool = await loadTool('DBTools.js', harness.container, {
            readFileSync: vi.fn(() => JSON.stringify(document)),
            writeFileSync: vi.fn(),
        });
        const tool = await withProcess(['-m', 'restore', '-o', 'synthetic-input'], () => new Tool());

        await tool.restore();

        expect(harness.dependencies.IRecordedTagDB.restore).toHaveBeenCalledWith(document.recordedTagItems);
        expect(harness.container.get).not.toHaveBeenCalledWith('IRecordedTagRelationDB');
        expect(relationRestore).not.toHaveBeenCalled();
    });

    it.each([
        ['restore stage characterization', 'IRuleDB', 'rule'],
        ['restore stage characterization', 'IReserveDB', 'reserve'],
        ['restore stage characterization', 'IDropLogFileDB', 'drop-log'],
        ['restore stage characterization', 'IRecordedDB', 'recorded'],
        ['restore stage characterization', 'IThumbnailDB', 'thumbnail'],
        ['restore stage characterization', 'IVideoFileDB', 'video-file'],
        ['restore stage characterization', 'IRecordedHistoryDB', 'recorded-history'],
        ['restore stage characterization', 'IRecordedTagDB', 'recorded-tag'],
    ])('[%s] preserves committed predecessors and stops at the %s stage', async (_caseName, repository, stage) => {
        const harness = makeDependencies();
        const failure = new Error(`synthetic ${stage} failure`);
        harness.dependencies[repository].restore.mockImplementation(async () => {
            harness.ledger.push(`restore:${stage}:attempt`);
            throw failure;
        });
        const Tool = await loadTool('DBTools.js', harness.container, {
            readFileSync: vi.fn(() => JSON.stringify(versionlessBackup())),
            writeFileSync: vi.fn(),
        });
        const tool = await withProcess(['-m', 'restore', '-o', 'synthetic-input'], () => new Tool());
        if (stage === 'drop-log') {
            const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            try {
                await expect(withProcess([], () => tool.restore())).rejects.toEqual(
                    expect.objectContaining({ code: 1 }),
                );
            } finally {
                error.mockRestore();
            }
        } else {
            await expect(tool.restore()).rejects.toBe(failure);
        }
        const attempts = harness.ledger.filter(value => value.startsWith('restore:'));
        expect(attempts.at(-1)).toBe(`restore:${stage}:attempt`);
        expect(attempts).toHaveLength(
            [
                'rule',
                'reserve',
                'drop-log',
                'recorded',
                'thumbnail',
                'video-file',
                'recorded-history',
                'recorded-tag',
            ].indexOf(stage) + 1,
        );
    });

    it('[restore input characterization] passes duplicate IDs and extra root data only to reached repository stages', async () => {
        const harness = makeDependencies();
        const duplicateRules = [{ id: 11 }, { id: 11 }];
        const Tool = await loadTool('DBTools.js', harness.container, {
            readFileSync: vi.fn(() =>
                JSON.stringify({ ...versionlessBackup(), ruleItems: duplicateRules, syntheticExtra: true }),
            ),
            writeFileSync: vi.fn(),
        });
        const tool = await withProcess(['-m', 'restore', '-o', 'synthetic-input'], () => new Tool());
        await tool.restore();
        expect(harness.dependencies.IRuleDB.restore).toHaveBeenCalledWith(duplicateRules);
        expect(harness.container.get).not.toHaveBeenCalledWith('syntheticExtra');
    });
    it('[MT-3.8] reports only restore error after release for every restore transaction failure point', async () => {
        for (const [index, stage] of mt38Stages.entries()) {
            for (const failure of mt38Faults) {
                await verifyMt38(stage, index, failure);
            }
        }
    });

    describe.each(mt38Stages.map((stage, index) => ({ ...stage, index })))(
        '[restore transaction characterization] $name stage',
        ({ index, ...stage }) => {
            it('[restore transaction characterization] commits and releases without a rollback when no failure is injected', async () => {
                const { fake, harness, tool } = await prepareMt38(stage, 'none');
                await withProcess([], () => tool.restore());
                expect(fake.events.filter(event => event !== 'delete' && event !== 'insert')).toEqual([
                    'start',
                    'commit',
                    'release-begin',
                    'release-end',
                ]);
                expect(fake.runner.rollbackTransaction).not.toHaveBeenCalled();
                expect(harness.ledger.filter(value => value.startsWith('restore:'))).toHaveLength(8);
            });

            it.each(mt38Faults)(
                '[restore transaction characterization] holds the $fault failure until release completes',
                async failure => {
                    await verifyMt38(stage, index, failure);
                },
            );
        },
    );
});
