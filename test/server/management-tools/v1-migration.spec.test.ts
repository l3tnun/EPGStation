import { describe, expect, it, vi } from 'vitest';
import { loadTool, makeDependencies, oldRecorded, oldRule, v1Backup, withProcess } from './_harness';

const makeTool = async () => {
    const harness = makeDependencies();
    const filesystem = { readFileSync: vi.fn(() => '{}'), writeFileSync: vi.fn() };
    const Tool = await loadTool('V1MigrationTool.js', harness.container, filesystem);
    const tool = await withProcess(['-i', 'synthetic-v1-input'], () => new Tool());
    return { filesystem, harness, tool };
};

describe('v1 migration characterization', () => {
    it.each(['MT-4.1', 'MT-4.2'])('[%s] reads and parses the file before probing the database', async () => {
        const harness = makeDependencies();
        const document = v1Backup({
            rules: [],
            recorded: [],
            encoded: [],
            recordedHistory: [],
            dbRevisionInfo: { revision: -999 },
        });
        const readFileSync = vi.fn(() => JSON.stringify(document));
        const Tool = await loadTool('V1MigrationTool.js', harness.container, { readFileSync, writeFileSync: vi.fn() });
        const tool = await withProcess(['-i', 'synthetic-v1-input'], () => new Tool());
        await expect(withProcess([], () => tool.run())).rejects.toEqual(expect.objectContaining({ code: 0 }));
        expect(readFileSync).toHaveBeenCalledBefore(harness.dependencies.IConnectionCheckModel.checkDB);
        expect(harness.dependencies.IConnectionCheckModel.checkDB).toHaveBeenCalledOnce();
        expect(harness.ledger).toEqual([
            'log:--- run ---',
            'log:--- read old backup file ---',
            'check-db',
            'log:--- import rules ---',
            'log:--- import recorded ---',
            'log:--- import encode video files ---',
            'log:--- import recorded history ---',
            'close-db',
            'log:--- finish ---',
        ]);
    });

    it.each([
        ['MT-4.3', 'missing file', Object.assign(new Error('synthetic missing v1 input'), { code: 'ENOENT' })],
        ['v1 input characterization', 'read failure', new Error('synthetic v1 read failure')],
        ['v1 input characterization', 'parse failure', undefined],
    ])('[%s] rejects %s before DB availability and inserts', async (_caseName, _label, readFailure) => {
        const harness = makeDependencies();
        const readFileSync = vi.fn(() => {
            if (readFailure !== undefined) throw readFailure;
            return '{invalid';
        });
        const Tool = await loadTool('V1MigrationTool.js', harness.container, { readFileSync, writeFileSync: vi.fn() });
        const tool = await withProcess(['-i', 'synthetic-v1-input'], () => new Tool());
        await expect(withProcess([], () => tool.run())).rejects.toEqual(expect.objectContaining({ code: 1 }));
        expect(harness.dependencies.IConnectionCheckModel.checkDB).not.toHaveBeenCalled();
        expect(harness.dependencies.IRuleDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.dependencies.IRecordedDB.insertOnce).not.toHaveBeenCalled();
    });

    it('[v1 input characterization] rejects a null backup file read before DB availability and inserts', async () => {
        const harness = makeDependencies();
        // readFileSync is typed `string | null`; every other failure case above throws instead, so
        // this exercises readV1BackupFile's own `file === null` guard (a real fs read with a 'utf-8'
        // encoding never actually returns null, but this class's injected readFileSync seam can).
        const readFileSync = vi.fn(() => null);
        const Tool = await loadTool('V1MigrationTool.js', harness.container, { readFileSync, writeFileSync: vi.fn() });
        const tool = await withProcess(['-i', 'synthetic-v1-input'], () => new Tool());
        await expect(withProcess([], () => tool.run())).rejects.toEqual(expect.objectContaining({ code: 1 }));
        expect(harness.dependencies.IConnectionCheckModel.checkDB).not.toHaveBeenCalled();
        expect(harness.dependencies.IRuleDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.dependencies.IRecordedDB.insertOnce).not.toHaveBeenCalled();
    });

    it.each([
        ['empty v1 recorded array', v1Backup({ recorded: [], encoded: [] })],
        ['non-string parent name', v1Backup()],
    ])(
        '[v1 input characterization] keeps the known %s input characteristic without revision gating',
        async (label, document) => {
            const harness = makeDependencies(
                label === 'non-string parent name'
                    ? { IConfiguration: { getConfig: () => ({ recorded: [{ name: 17 }], encode: [] }) } }
                    : {},
            );
            const Tool = await loadTool('V1MigrationTool.js', harness.container, {
                readFileSync: vi.fn(() => JSON.stringify({ ...document, dbRevisionInfo: { revision: -999 } })),
                writeFileSync: vi.fn(),
            });
            const tool = await withProcess(['-i', 'synthetic-v1-input'], () => new Tool());
            await expect(withProcess([], () => tool.run())).rejects.toEqual(expect.objectContaining({ code: 0 }));
            expect(harness.dependencies.IConnectionCheckModel.checkDB).toHaveBeenCalledOnce();
            if (label === 'non-string parent name') {
                expect(harness.log.system.error).toHaveBeenCalledWith('check recorded name error');
            }
        },
    );

    it('[v1 input characterization] rejects before reading the v1 file when the configured recorded list is empty', async () => {
        const harness = makeDependencies({
            IConfiguration: { getConfig: () => ({ recorded: [], encode: [] }) },
        });
        const readFileSync = vi.fn(() => JSON.stringify(v1Backup()));
        const Tool = await loadTool('V1MigrationTool.js', harness.container, { readFileSync, writeFileSync: vi.fn() });
        const tool = await withProcess(['-i', 'synthetic-v1-input'], () => new Tool());

        await expect(withProcess([], () => tool.run())).rejects.toBeInstanceOf(TypeError);

        expect(readFileSync).not.toHaveBeenCalled();
        expect(harness.dependencies.IConnectionCheckModel.checkDB).not.toHaveBeenCalled();
        expect(harness.dependencies.IRuleDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.dependencies.IRecordedDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.dependencies.IThumbnailDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.dependencies.IVideoFileDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.dependencies.IRecordedHistoryDB.insertOnce).not.toHaveBeenCalled();
        expect(harness.dependencies.IDBOperator.closeConnection).not.toHaveBeenCalled();
        expect(harness.ledger).toEqual(['log:--- run ---']);
    });

    it('[MT-4.4] maps nullable rule fields, encode slots, and old/new IDs in insertion order', async () => {
        const { harness, tool } = await makeTool();
        harness.dependencies.IRuleDB.insertOnce.mockResolvedValueOnce(71).mockResolvedValueOnce(72);
        const index = await tool.imporRule(
            [
                oldRule({ id: 1, keyword: 'synthetic-keyword', station: 9, mode1: 0, directory1: 'synthetic-encode' }),
                oldRule({ id: 2 }),
            ],
            'synthetic-recorded-root',
        );
        expect(index).toEqual({ 1: 71, 2: 72 });
        expect(harness.dependencies.IRuleDB.insertOnce.mock.calls[0][0]).toMatchObject({
            searchOption: { keyword: 'synthetic-keyword', channelIds: [9] },
            encodeOption: { mode1: 'synthetic-mode-1', directory1: 'synthetic-encode' },
        });
    });

    it('[v1 rule conversion characterization] maps every nullable rule branch and all three encode slots from the configuration snapshot', async () => {
        const { tool } = await makeTool();
        const nullable = tool.convertOldRuleToAddRuleOption(oldRule(), 'synthetic-recorded-root');
        expect(nullable).toEqual({
            isTimeSpecification: false,
            searchOption: { times: [{ week: 1 }] },
            reserveOption: { enable: true, allowEndLack: false, avoidDuplicate: false },
            saveOption: { parentDirectoryName: 'synthetic-recorded-root' },
        });
        const populated = tool.convertOldRuleToAddRuleOption(
            oldRule({
                keyword: 'synthetic-keyword',
                ignoreKeyword: 'synthetic-ignore',
                keyCS: true,
                keyRegExp: false,
                title: true,
                description: true,
                extended: true,
                ignoreKeyCS: true,
                ignoreKeyRegExp: false,
                ignoreTitle: true,
                ignoreDescription: true,
                ignoreExtended: true,
                GR: true,
                BS: false,
                CS: true,
                SKY: false,
                station: 9,
                genrelv1: 10,
                genrelv2: 11,
                startTime: 12,
                timeRange: 13,
                week: 14,
                isFree: true,
                durationMin: 15,
                durationMax: 16,
                periodToAvoidDuplicate: 17,
                directory: 'synthetic-directory',
                recordedFormat: 'synthetic-format',
                mode1: 0,
                mode2: 1,
                mode3: 2,
                directory1: 'synthetic-one',
                directory2: 'synthetic-two',
                directory3: 'synthetic-three',
                delTs: true,
            }),
            'synthetic-recorded-root',
        );
        expect(populated.searchOption).toEqual({
            keyword: 'synthetic-keyword',
            ignoreKeyword: 'synthetic-ignore',
            keyCS: true,
            keyRegExp: false,
            name: true,
            description: true,
            extended: true,
            ignoreKeyCS: true,
            ignoreKeyRegExp: false,
            ignoreName: true,
            ignoreDescription: true,
            ignoreExtended: true,
            GR: true,
            BS: false,
            CS: true,
            SKY: false,
            channelIds: [9],
            genres: [{ genre: 10, subGenre: 11 }],
            times: [{ start: 12, range: 13, week: 14 }],
            isFree: true,
            durationMin: 15,
            durationMax: 16,
        });
        expect(populated.reserveOption).toEqual({
            enable: true,
            allowEndLack: false,
            avoidDuplicate: false,
            periodToAvoidDuplicate: 17,
        });
        expect(populated.saveOption).toEqual({
            directory: 'synthetic-directory',
            recordedFormat: 'synthetic-format',
            parentDirectoryName: 'synthetic-recorded-root',
        });
        expect(populated.encodeOption).toEqual({
            isDeleteOriginalAfterEncode: true,
            mode1: 'synthetic-mode-1',
            encodeParentDirectoryName1: 'synthetic-recorded-root',
            directory1: 'synthetic-one',
            mode2: 'synthetic-mode-2',
            encodeParentDirectoryName2: 'synthetic-recorded-root',
            directory2: 'synthetic-two',
            mode3: 'synthetic-mode-3',
            encodeParentDirectoryName3: 'synthetic-recorded-root',
            directory3: 'synthetic-three',
        });
    });

    it('[v1 rule conversion characterization] maps a genre with no v1 sub-genre to a genre-only entry', async () => {
        const { tool } = await makeTool();
        // The other conversion test above only exercises genrelv1+genrelv2 both set (subGenre
        // present); this covers the genrelv2 === null arm, which drops the subGenre field entirely.
        const single = tool.convertOldRuleToAddRuleOption(oldRule({ genrelv1: 10, genrelv2: null }), 'synthetic-root');
        expect(single.searchOption.genres).toEqual([{ genre: 10 }]);
    });

    it('[MT-4.5] maps recorded state and keeps the original extended with its half-width form', async () => {
        const { tool } = await makeTool();
        const result = tool.convertOldRecordedToRecorded(oldRecorded(), 'synthetic-recorded-root', { 1: 81 });
        expect(result.recorded).toMatchObject({
            ruleId: 81,
            programId: null,
            isProtected: false,
            isRecording: false,
            extended: 'ＡＢ',
            halfWidthExtended: 'AB',
            rawExtended: null,
            rawHalfWidthExtended: null,
        });
        expect(result.videoFile).toMatchObject({ type: 'ts', name: 'ts', size: 0 });
    });

    it.each([
        ['recording and protected', { recording: true, protection: true }],
        ['not recording and not protected', { recording: false, protection: false }],
    ])('[MT-4.9] sets isRecording and isProtected to false whatever the v1 state is: %s', async (_label, state) => {
        const { tool } = await makeTool();
        const result = tool.convertOldRecordedToRecorded(oldRecorded(state), 'synthetic-recorded-root', { 1: 81 });
        expect(result.recorded.isRecording).toBe(false);
        expect(result.recorded.isProtected).toBe(false);
    });

    it('[MT-4.10] does not copy the excluded v1 fields or temporary recording state to the recorded row', async () => {
        const { tool } = await makeTool();
        const result = tool.convertOldRecordedToRecorded(
            oldRecorded({
                audioSamplingRate: 48_000,
                logPath: 'synthetic-excluded.log',
                errorCnt: 1,
                dropCnt: 2,
                scramblingCnt: 3,
                isTmp: true,
                recording: true,
            }),
            'synthetic-recorded-root',
            { 1: 81 },
        );
        for (const key of ['audioSamplingRate', 'logPath', 'errorCnt', 'dropCnt', 'scramblingCnt', 'isTmp']) {
            expect(Object.hasOwn(result.recorded, key), `${key} must not be copied`).toBe(false);
        }
        expect(result.recorded.rawExtended).toBeNull();
        expect(result.recorded.rawHalfWidthExtended).toBeNull();
        expect(result.recorded.isRecording).toBe(false);
    });

    it.each([
        ['known rule and program', { ruleId: 1, programId: 101 }, 81, 101],
        ['manual program', { ruleId: null, programId: -1 }, undefined, null],
        ['unknown rule', { ruleId: 999, programId: 0 }, undefined, null],
    ])(
        '[recorded conversion characterization] maps %s without excluded runtime fields',
        async (_label, input, ruleId, programId) => {
            const { tool } = await makeTool();
            const result = tool.convertOldRecordedToRecorded(
                oldRecorded({
                    ...input,
                    description: null,
                    extended: null,
                    recPath: null,
                    thumbnailPath: null,
                    audioSamplingRate: 48_000,
                    logPath: 'synthetic-excluded.log',
                    errorCnt: 1,
                    dropCnt: 2,
                    scramblingCnt: 3,
                    recording: true,
                }),
                'synthetic-recorded-root',
                { 1: 81 },
            );
            expect(result.recorded).toMatchObject({ programId, isRecording: false });
            if (ruleId === undefined) {
                expect(result.recorded).not.toHaveProperty('ruleId');
            } else {
                expect(result.recorded.ruleId).toBe(ruleId);
            }
            expect(result.recorded).not.toHaveProperty('description');
            expect(result.recorded).not.toHaveProperty('extended');
            expect(result.recorded).not.toHaveProperty('halfWidthExtended');
            expect(result).not.toHaveProperty('thumbnail');
            expect(result).not.toHaveProperty('videoFile');
            expect(result.recorded).not.toHaveProperty('audioSamplingRate');
            expect(result.recorded).not.toHaveProperty('logPath');
            expect(result.recorded).not.toHaveProperty('errorCnt');
        },
    );

    it.each(['MT-4.6', 'MT-4.8', 'MT-4.11'])(
        '[%s] associates metadata without reserve/drop or filesystem ports',
        async () => {
            const { filesystem, harness, tool } = await makeTool();
            harness.dependencies.IRecordedDB.insertOnce.mockResolvedValue(91);
            await tool.importRecorded([oldRecorded()], 'synthetic-recorded-root', { 1: 81 });
            expect(harness.dependencies.IThumbnailDB.insertOnce).toHaveBeenCalledWith(
                expect.objectContaining({ recordedId: 91 }),
            );
            expect(harness.dependencies.IVideoFileDB.insertOnce).toHaveBeenCalledWith(
                expect.objectContaining({ recordedId: 91 }),
            );
            expect(harness.container.get).not.toHaveBeenCalledWith('IReserveDB');
            expect(harness.container.get).not.toHaveBeenCalledWith('IDropLogFileDB');
            expect(filesystem.readFileSync).not.toHaveBeenCalled();
            expect(filesystem.writeFileSync).not.toHaveBeenCalled();
            expect(Object.keys(filesystem)).toEqual(['readFileSync', 'writeFileSync']);
        },
    );

    it('[MT-4.7] inserts every v1 recorded-history row with its preserved fields', async () => {
        const { harness, tool } = await makeTool();
        const history = [
            { name: 'synthetic-history-one', channelId: 21, endAt: 31 },
            { name: 'synthetic-history-two', channelId: 22, endAt: 32 },
        ];

        await tool.importRecordedHistory(history);

        expect(harness.dependencies.IRecordedHistoryDB.insertOnce).toHaveBeenCalledTimes(2);
        expect(harness.dependencies.IRecordedHistoryDB.insertOnce).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining(history[0]),
        );
        expect(harness.dependencies.IRecordedHistoryDB.insertOnce).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining(history[1]),
        );
    });

    it.each(['MT-4.12', 'MT-4.13'])('[%s] keeps fixed stages and prior inserts after a later failure', async () => {
        const harness = makeDependencies();
        harness.dependencies.IRuleDB.insertOnce.mockResolvedValue(71);
        harness.dependencies.IRecordedDB.insertOnce.mockResolvedValue(81);
        harness.dependencies.IVideoFileDB.insertOnce.mockRejectedValue(new Error('synthetic encoded failure'));
        const document = v1Backup({
            rules: [oldRule()],
            recorded: [oldRecorded({ recPath: null, thumbnailPath: null })],
            encoded: [{ recordedId: 10, path: 'synthetic-encoded', name: 'encoded', filesize: null }],
            recordedHistory: [{ name: 'synthetic-history', channelId: 2, endAt: 20 }],
            dbRevisionInfo: { revision: 1 },
        });
        const Tool = await loadTool('V1MigrationTool.js', harness.container, {
            readFileSync: vi.fn(() => JSON.stringify(document)),
            writeFileSync: vi.fn(),
        });
        const tool = await withProcess(['-i', 'synthetic-v1-input'], () => new Tool());
        await expect(tool.run()).rejects.toThrow('synthetic encoded failure');
        expect(harness.dependencies.IRuleDB.insertOnce).toHaveBeenCalledOnce();
        expect(harness.dependencies.IRecordedDB.insertOnce).toHaveBeenCalledOnce();
        expect(harness.dependencies.IRecordedHistoryDB.insertOnce).not.toHaveBeenCalled();
    });

    it.each(['rule', 'recorded', 'thumbnail', 'original-video', 'encoded-video', 'history'])(
        '[v1 stage characterization] stops after the %s insertion failure and preserves earlier calls',
        async stage => {
            const harness = makeDependencies();
            const failure = new Error(`synthetic ${stage} failure`);
            const committed: string[] = [];
            const insert = (name: string, id: number) => async () => {
                if (stage === name) throw failure;
                committed.push(name);
                return id;
            };
            harness.dependencies.IRuleDB.insertOnce.mockImplementation(insert('rule', 71));
            harness.dependencies.IRecordedDB.insertOnce.mockImplementation(insert('recorded', 81));
            harness.dependencies.IThumbnailDB.insertOnce.mockImplementation(insert('thumbnail', 91));
            let videoCall = 0;
            harness.dependencies.IVideoFileDB.insertOnce.mockImplementation(async () => {
                const name = videoCall++ === 0 ? 'original-video' : 'encoded-video';
                if (stage === name) throw failure;
                committed.push(name);
                return 101;
            });
            harness.dependencies.IRecordedHistoryDB.insertOnce.mockImplementation(insert('history', 111));
            const Tool = await loadTool('V1MigrationTool.js', harness.container, {
                readFileSync: vi.fn(() => JSON.stringify(v1Backup())),
                writeFileSync: vi.fn(),
            });
            const tool = await withProcess(['-i', 'synthetic-v1-input'], () => new Tool());
            await expect(tool.run()).rejects.toBe(failure);
            const stages = ['rule', 'recorded', 'thumbnail', 'original-video', 'encoded-video', 'history'];
            const failedIndex = stages.indexOf(stage);
            expect(committed).toEqual(stages.slice(0, failedIndex));
            expect(harness.dependencies.IRuleDB.insertOnce).toHaveBeenCalledTimes(failedIndex >= 0 ? 1 : 0);
            expect(harness.dependencies.IRecordedDB.insertOnce).toHaveBeenCalledTimes(failedIndex >= 1 ? 1 : 0);
            expect(harness.dependencies.IThumbnailDB.insertOnce).toHaveBeenCalledTimes(failedIndex >= 2 ? 1 : 0);
            expect(harness.dependencies.IVideoFileDB.insertOnce).toHaveBeenCalledTimes(
                failedIndex < 3 ? 0 : failedIndex === 3 ? 1 : 2,
            );
            expect(harness.dependencies.IRecordedHistoryDB.insertOnce).toHaveBeenCalledTimes(failedIndex === 5 ? 1 : 0);
            expect(harness.log.system.info).not.toHaveBeenCalledWith('--- finish ---');
            expect(harness.dependencies.IDBOperator.closeConnection).not.toHaveBeenCalled();
        },
    );

    it('[v1 stage characterization] reruns the same input without checkpoint or duplicate suppression', async () => {
        const harness = makeDependencies();
        harness.dependencies.IRuleDB.insertOnce.mockResolvedValue(71);
        harness.dependencies.IRecordedDB.insertOnce.mockResolvedValue(81);
        const Tool = await loadTool('V1MigrationTool.js', harness.container, {
            readFileSync: vi.fn(() => JSON.stringify(v1Backup())),
            writeFileSync: vi.fn(),
        });
        const tool = await withProcess(['-i', 'synthetic-v1-input'], () => new Tool());
        await expect(withProcess([], () => tool.run())).rejects.toEqual(expect.objectContaining({ code: 0 }));
        await expect(withProcess([], () => tool.run())).rejects.toEqual(expect.objectContaining({ code: 0 }));
        expect(harness.dependencies.IRuleDB.insertOnce).toHaveBeenCalledTimes(2);
        expect(harness.dependencies.IRecordedDB.insertOnce).toHaveBeenCalledTimes(2);
        expect(harness.dependencies.IThumbnailDB.insertOnce).toHaveBeenCalledTimes(2);
        expect(harness.dependencies.IVideoFileDB.insertOnce).toHaveBeenCalledTimes(4);
        expect(harness.dependencies.IRecordedHistoryDB.insertOnce).toHaveBeenCalledTimes(2);
    });
});
