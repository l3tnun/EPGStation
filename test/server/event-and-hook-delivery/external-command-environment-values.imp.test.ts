import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeRecorded } from './_harness';
import {
    commandFor,
    DeferredCommandChild,
    hookFamilies,
    installSpawnStub,
    makeCommandQueueHarness,
    processStubs,
    resetCommandHarness,
    restoreSpawnStub,
} from './external-command-test-harness';

beforeAll(() => installSpawnStub());
afterEach(() => resetCommandHarness());
afterAll(() => restoreSpawnStub());

type CommandHarness = ReturnType<typeof makeCommandQueueHarness>;

// 実行待ちqueueを経由せず、準備中のcommandだけを用意してcreate*Cmdを直接呼ぶ。
const prepare = (harness: CommandHarness): void => {
    harness.model.activeHookCommand = {
        child: null,
        cmd: 'synthetic command',
        commandPromise: null,
        commandType: 'synthetic-type',
        completion: Promise.resolve(),
        deadlineTimer: null,
        errorListener: null,
        exitListener: null,
        finalized: false,
        killGraceTimer: null,
        resolveCompletion: () => undefined,
        sentSignals: [],
        settled: false,
        terminationGraceTimer: null,
        timedOut: false,
    };
    processStubs.spawn.mockReturnValue(new DeferredCommandChild(2_000));
    vi.spyOn(harness.model, 'superviseChild').mockResolvedValue(undefined);
};

const spawnedEnvironment = (): Record<string, unknown> =>
    (processStubs.spawn.mock.calls[0][2] as { env: Record<string, unknown> }).env;

describe('[EH-7.2] encoding-finish command environment', () => {
    it('passes an empty video file id and a null output path when the encode produced no video file', async () => {
        const harness = makeCommandQueueHarness();
        prepare(harness);

        await harness.model.createFinishEncodeCmd(commandFor(hookFamilies[8].label), {
            mode: 'synthetic-mode',
            recordedId: 119,
            videoFileId: null,
        });

        expect(harness.videoUtil.getFullFilePathFromId).not.toHaveBeenCalled();
        expect(spawnedEnvironment()).toMatchObject({
            MODE: 'synthetic-mode',
            OUTPUTPATH: null,
            RECORDEDID: 119,
            VIDEOFILEID: '',
        });
    });

    it('passes empty channel values when the recorded channel id and the channel names are not usable', async () => {
        const harness = makeCommandQueueHarness();
        prepare(harness);
        harness.recordedDB.findId.mockResolvedValue(makeRecorded({ channelId: undefined, id: 119 }));
        harness.channelDB.findId.mockResolvedValue({ channelType: 'BS', halfWidthName: null, name: null });

        await harness.model.createFinishEncodeCmd(commandFor(hookFamilies[8].label), hookFamilies[8].makePayload());

        expect(harness.channelDB.findId).toHaveBeenCalledWith(undefined);
        expect(spawnedEnvironment()).toMatchObject({
            CHANNELID: '',
            CHANNELNAME: '',
            HALF_WIDTH_CHANNELNAME: '',
            OUTPUTPATH: 'synthetic-video-219',
            VIDEOFILEID: 219,
        });
    });
});

describe('[EH-7.2] recording command environment for the drop log', () => {
    it('passes the drop log path and the stringified counters when the recorded has a drop log file', async () => {
        const harness = makeCommandQueueHarness({ dropLog: 'synthetic-drop-root' });
        prepare(harness);
        const recorded = hookFamilies[5].makePayload();
        recorded.dropLogFile = { dropCnt: 0, errorCnt: 3, filePath: 'synthetic.log', scramblingCnt: 15 };

        await harness.model.createRecordedCmd(commandFor(hookFamilies[5].label), recorded);

        expect(spawnedEnvironment()).toMatchObject({
            DROP_CNT: '0',
            ERROR_CNT: '3',
            LOGPATH: join('synthetic-drop-root', 'synthetic.log'),
            SCRAMBLING_CNT: '15',
        });
    });

    it('passes null for the drop log path and counters when the recorded has no drop log file', async () => {
        const harness = makeCommandQueueHarness();
        prepare(harness);
        const recorded = hookFamilies[5].makePayload();
        recorded.dropLogFile = null;

        await harness.model.createRecordedCmd(commandFor(hookFamilies[5].label), recorded);

        expect(spawnedEnvironment()).toMatchObject({
            DROP_CNT: null,
            ERROR_CNT: null,
            LOGPATH: null,
            SCRAMBLING_CNT: null,
        });
    });
});
