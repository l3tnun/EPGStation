import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeRecorded, makeReserve, ProcessUtil } from './_harness';
import {
    DeferredCommandChild,
    hookFamilies,
    installSpawnStub,
    makeCommandQueueHarness,
    processStubs,
    resetCommandHarness,
    restoreSpawnStub,
    waitFor,
} from './external-command-test-harness';

const configuredCommand =
    '%NODE% %ROOT%/synthetic-script.cjs "synthetic%SPACE%quoted" $SYNTHETIC_HOOK_PARENT_MARKER | > synthetic%SPACE%space';

beforeAll(() => installSpawnStub());
afterEach(() => resetCommandHarness());
afterAll(() => restoreSpawnStub());

const captureSpawnEnvironment = async (
    invoke: (model: any) => void,
): Promise<Record<string, string | null | undefined>> => {
    const harness = makeCommandQueueHarness();
    const child = new DeferredCommandChild(1_700);
    processStubs.spawn.mockReturnValue(child);

    invoke(harness.model);
    await waitFor(() => processStubs.spawn.mock.calls.length === 1, 'configured command did not reach direct spawn');
    const environment = processStubs.spawn.mock.calls[0][2].env;
    child.emitExit(0);
    await Promise.all(harness.queueAdd.mock.results.map(result => result.value));
    return environment;
};

describe('configured external command consumer contract', () => {
    it('[EH-5.1] preserves the configured executable and argument order supplied by the configuration provider', () => {
        expect(ProcessUtil.parseCmdStr(configuredCommand)).toEqual({
            args: [
                `${ProcessUtil.ROOT_PATH}/synthetic-script.cjs`,
                '"synthetic quoted"',
                '$SYNTHETIC_HOOK_PARENT_MARKER',
                '|',
                '>',
                'synthetic space',
            ],
            bin: process.argv[0],
        });
    });

    it('[EH-5.2] leaves shell metacharacters and parent-style variables as literal arguments', () => {
        const { args } = ProcessUtil.parseCmdStr(configuredCommand);

        expect(args).toContain('$SYNTHETIC_HOOK_PARENT_MARKER');
        expect(args).toContain('|');
        expect(args).toContain('>');
    });

    it('[EH-5.3] does not make the configured Node symbol a second consumer-side language', () => {
        expect(configuredCommand).toContain('%NODE%');
        expect(ProcessUtil.parseCmdStr(configuredCommand).bin).toBe(process.argv[0]);
    });

    it('[EH-5.4] leaves ROOT and SPACE provider substitutions as already-resolved command values', () => {
        const { args } = ProcessUtil.parseCmdStr(configuredCommand);

        expect(configuredCommand).toContain('%ROOT%');
        expect(configuredCommand).toContain('%NODE%');
        expect(configuredCommand).toContain('%SPACE%');
        expect(args).toContain(`${ProcessUtil.ROOT_PATH}/synthetic-script.cjs`);
        expect(args).toContain('synthetic space');
    });

    it.each(hookFamilies)(
        '[EH-5.1-CONSUMER-EXACT] spawns the $label interpreter result unchanged and parses the configured string once',
        async family => {
            const interpreted = {
                args: ['%NODE%', '%ROOT%', '%SPACE%', '$SYNTHETIC_HOOK_PARENT_MARKER', '"quoted"', '|', '>', 'a b', ''],
                bin: '/synthetic/interpreted-bin',
            };
            const harness = makeCommandQueueHarness({ [family.configKey]: configuredCommand });
            const parse = vi.spyOn(ProcessUtil, 'parseCmdStr').mockReturnValue(interpreted);
            const child = new DeferredCommandChild(1_800);
            processStubs.spawn.mockReturnValue(child);

            family.invoke(harness.model, family.makePayload());
            await waitFor(
                () => processStubs.spawn.mock.calls.length === 1,
                'configured command did not reach direct spawn',
            );

            expect(parse).toHaveBeenCalledExactlyOnceWith(configuredCommand);
            expect(processStubs.spawn.mock.calls[0][0]).toBe(interpreted.bin);
            expect(processStubs.spawn.mock.calls[0][1]).toEqual(interpreted.args);
            expect(processStubs.spawn.mock.calls[0][1]).toHaveLength(9);
            child.emitExit(0);
            await Promise.all(harness.queueAdd.mock.results.map(result => result.value));
        },
    );

    it('[EH-5.2-CONSUMER-NO-SHELL] spawns with stdio ignored and without a shell option', async () => {
        const family = hookFamilies[3];
        const harness = makeCommandQueueHarness({ [family.configKey]: configuredCommand });
        const child = new DeferredCommandChild(1_801);
        processStubs.spawn.mockReturnValue(child);

        family.invoke(harness.model, family.makePayload());
        await waitFor(
            () => processStubs.spawn.mock.calls.length === 1,
            'configured command did not reach direct spawn',
        );

        const options = processStubs.spawn.mock.calls[0][2];
        expect(options.shell ?? false).toBe(false);
        expect(options.stdio).toBe('ignore');
        expect(Object.keys(options).sort()).toEqual(['env', 'stdio']);
        child.emitExit(0);
        await Promise.all(harness.queueAdd.mock.results.map(result => result.value));
    });

    it('[EH-5.5] builds the reserve PATH-plus-event allowlist before direct spawn', async () => {
        const environment = await captureSpawnEnvironment(model => model.addRecordingPrepStartCmd(makeReserve()));

        expect(Object.keys(environment).sort()).toEqual([
            'CHANNELID',
            'CHANNELNAME',
            'CHANNELTYPE',
            'DESCRIPTION',
            'DURATION',
            'ENDAT',
            'EXTENDED',
            'HALF_WIDTH_CHANNELNAME',
            'HALF_WIDTH_DESCRIPTION',
            'HALF_WIDTH_EXTENDED',
            'HALF_WIDTH_NAME',
            'NAME',
            'PATH',
            'PROGRAMID',
            'RESERVEID',
            'STARTAT',
        ]);
    });

    it('[EH-5.6] excludes a parent-only environment marker from the direct-child environment', async () => {
        const parentMarker = 'SYNTHETIC_HOOK_PARENT_MARKER';
        const previous = process.env[parentMarker];
        process.env[parentMarker] = 'parent-only-value';
        try {
            const environment = await captureSpawnEnvironment(model => model.addRecordingPrepStartCmd(makeReserve()));

            expect(environment).not.toHaveProperty(parentMarker);
        } finally {
            if (previous === undefined) delete process.env[parentMarker];
            else process.env[parentMarker] = previous;
        }
    });

    it('[EH-5.7] preserves reserve, program, and channel values in the reserve profile', async () => {
        const reserve = makeReserve({ endAt: 2_500, startAt: 1_000 });
        const environment = await captureSpawnEnvironment(model => model.addRecordingPrepStartCmd(reserve));

        expect(environment).toMatchObject({
            CHANNELID: reserve.channelId,
            CHANNELNAME: 'synthetic-channel',
            CHANNELTYPE: reserve.channelType,
            DURATION: reserve.endAt - reserve.startAt,
            PROGRAMID: reserve.programId,
            RESERVEID: reserve.id,
        });
    });

    it('[EH-5.8] uses the recorded/file profile rather than adding reserve-only values', async () => {
        const recorded = makeRecorded({ videoFiles: [{ id: 41 }] });
        const environment = await captureSpawnEnvironment(model => model.addRecordingStartCmd(recorded));

        expect(environment).toMatchObject({
            CHANNELID: recorded.channelId,
            RECORDEDID: recorded.id,
            RECPATH: 'synthetic-video-41',
        });
        expect(environment).not.toHaveProperty('RESERVEID');
    });

    it('[EH-5.9] preserves null, empty, and unset fields until the process boundary applies its representation', async () => {
        const reserve = makeReserve({
            description: null,
            extended: undefined,
            halfWidthDescription: '',
            halfWidthExtended: null,
        });
        const environment = await captureSpawnEnvironment(model => model.addRecordingPrepStartCmd(reserve));

        expect(environment).toMatchObject({
            DESCRIPTION: null,
            HALF_WIDTH_DESCRIPTION: '',
            HALF_WIDTH_EXTENDED: null,
        });
        expect(environment).toHaveProperty('EXTENDED', undefined);
    });
});
