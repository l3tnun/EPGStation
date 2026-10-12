import { describe, expect, it, vi } from 'vitest';
import { loadTool, makeDependencies, oldRecorded, oldRule, withProcess } from './_harness';

describe('v1 converter implementation characterization', () => {
    it('[MT-4.4] rejects an unknown encode index without fallback', async () => {
        const harness = makeDependencies();
        const Tool = await loadTool('V1MigrationTool.js', harness.container, {
            readFileSync: vi.fn(),
            writeFileSync: vi.fn(),
        });
        const tool = await withProcess(['-i', 'synthetic-v1-input'], () => new Tool());
        expect(() => tool.convertOldRuleToAddRuleOption(oldRule({ mode1: 99 }), 'synthetic-root')).toThrow(
            'EncodeOptionError',
        );
    });

    it('[MT-4.6] maps null encoded size to zero and rejects an unknown recorded ID', async () => {
        const harness = makeDependencies();
        const Tool = await loadTool('V1MigrationTool.js', harness.container, {
            readFileSync: vi.fn(),
            writeFileSync: vi.fn(),
        });
        const tool = await withProcess(['-i', 'synthetic-v1-input'], () => new Tool());
        expect(
            tool.convertOldEncodedItemToVideoFile(
                { recordedId: 1, path: 'synthetic-encoded', name: 'encoded', filesize: null },
                'synthetic-root',
                { 1: 8 },
            ),
        ).toMatchObject({ recordedId: 8, size: 0, type: 'encoded' });
        expect(() =>
            tool.convertOldEncodedItemToVideoFile(
                { recordedId: 2, path: 'synthetic-encoded', name: 'encoded', filesize: 1 },
                'synthetic-root',
                {},
            ),
        ).toThrow('OldRecordedIdError');
    });

    it('[IMP-CHAR-MT-7.2:nullable-zero-one-index-omission-duplicate] characterizes v1 values, omissions, projections, and duplicate IDs', async () => {
        const harness = makeDependencies();
        const Tool = await loadTool('V1MigrationTool.js', harness.container, {
            readFileSync: vi.fn(),
            writeFileSync: vi.fn(),
        });
        const tool = await withProcess(['--input', 'synthetic-v1-input'], () => new Tool());

        expect(tool.convertOldRuleToAddRuleOption(oldRule(), 'synthetic-root')).not.toHaveProperty('encodeOption');
        expect(tool.convertOldRuleToAddRuleOption(oldRule({ mode1: 0 }), 'synthetic-root')).toMatchObject({
            encodeOption: { mode1: 'synthetic-mode-1' },
        });
        expect(tool.convertOldRuleToAddRuleOption(oldRule({ mode1: 2 }), 'synthetic-root')).toMatchObject({
            encodeOption: { mode1: 'synthetic-mode-3' },
        });
        expect(() => tool.convertOldRuleToAddRuleOption(oldRule({ mode1: 3 }), 'synthetic-root')).toThrow(
            'EncodeOptionError',
        );
        expect(tool.convertOldRuleToAddRuleOption(oldRule({ mode1: '0' }), 'synthetic-root')).not.toHaveProperty(
            'encodeOption',
        );

        expect(tool.convertOldRecordedToRecorded(oldRecorded({ programId: -1 }), 'synthetic-root', {})).toMatchObject({
            recorded: { programId: null },
        });
        expect(tool.convertOldRecordedToRecorded(oldRecorded({ programId: 0 }), 'synthetic-root', {})).toMatchObject({
            recorded: { programId: null },
        });
        expect(tool.convertOldRecordedToRecorded(oldRecorded({ programId: 1 }), 'synthetic-root', {})).toMatchObject({
            recorded: { programId: 1 },
        });

        expect(await tool.imporRule([], 'synthetic-root')).toEqual({});
        harness.dependencies.IRuleDB.insertOnce.mockResolvedValueOnce(71).mockResolvedValueOnce(72);
        await expect(tool.imporRule([oldRule({ id: 9 }), oldRule({ id: 9 })], 'synthetic-root')).resolves.toEqual({
            9: 72,
        });
        expect(harness.dependencies.IRuleDB.insertOnce).toHaveBeenCalledTimes(2);

        const constraintHarness = makeDependencies();
        const ConstraintTool = await loadTool('V1MigrationTool.js', constraintHarness.container, {
            readFileSync: vi.fn(),
            writeFileSync: vi.fn(),
        });
        const constraintTool = await withProcess(['--input', 'synthetic-v1-input'], () => new ConstraintTool());
        const constraintError = new Error('synthetic duplicate old rule constraint');
        constraintHarness.dependencies.IRuleDB.insertOnce
            .mockResolvedValueOnce(71)
            .mockRejectedValueOnce(constraintError);
        await expect(
            constraintTool.imporRule([oldRule({ id: 10 }), oldRule({ id: 10 })], 'synthetic-root'),
        ).rejects.toBe(constraintError);
        expect(constraintHarness.dependencies.IRuleDB.insertOnce).toHaveBeenCalledTimes(2);

        const withoutFiles = tool.convertOldRecordedToRecorded(
            oldRecorded({ recPath: null, thumbnailPath: null, programId: 0 }),
            'synthetic-root',
            {},
        );
        expect(withoutFiles).toEqual({
            recorded: expect.objectContaining({
                isProtected: false,
                isRecording: false,
                programId: null,
                extended: 'ＡＢ',
                halfWidthExtended: 'AB',
                rawExtended: null,
                rawHalfWidthExtended: null,
            }),
        });

        const withFiles = tool.convertOldRecordedToRecorded(
            oldRecorded({ filesize: 1, programId: 1 }),
            'synthetic-root',
            { 1: 71 },
        );
        expect(withFiles).toMatchObject({
            recorded: { ruleId: 71, programId: 1 },
            thumbnail: { filePath: 'synthetic-thumbnail.jpg' },
            videoFile: {
                parentDirectoryName: 'synthetic-root',
                filePath: 'synthetic-media.ts',
                type: 'ts',
                size: 1,
            },
        });
        expect(
            tool.convertOldRecordedToRecorded(oldRecorded({ filesize: null }), 'synthetic-root', {}).videoFile,
        ).toMatchObject({ size: 0 });
    });
});
