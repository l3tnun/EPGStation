// 停止時間帯（encodeSuspendTimes）を、サマータイムのある時刻帯で動かす子 process。
// 親の test が `TZ` を指定して起動し、各 scenario の観測結果を JSON で stdout へ書く。
// worker thread の中では `process.env.TZ` を切り替えられないため、時刻帯ごとに子 process を分ける。
import { mock } from 'node:test';

const { default: EncodeManageModel } = await import(process.env.ENCODE_MANAGE_MODEL_URL);
const { default: EncodeEvent } = await import(process.env.ENCODE_EVENT_URL);

const STEP_MS = 1000;

const flushEventLoop = async () => {
    for (let round = 0; round < 8; round += 1) {
        await new Promise(resolve => setImmediate(resolve));
    }
};

const makeEncoder = () => {
    let encodeOption = null;
    const item = {
        started: false,
        cancel: async () => undefined,
        getEncodeId: () => encodeOption?.encodeId ?? null,
        getEncodeOption: () => encodeOption,
        getProgressInfo: () => null,
        setOnFinish: () => undefined,
        setOption: value => {
            encodeOption = value;
        },
        start: async () => {
            item.started = true;
        },
    };

    return item;
};

const option = recordedId => ({
    directory: 'synthetic-subdirectory',
    mode: 'synthetic-mode',
    parentDir: 'synthetic-parent',
    recordedId,
    removeOriginal: false,
    sourceVideoFileId: recordedId + 1,
});

const wallClock = () => {
    const now = new Date();

    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

/**
 * scenario を一つ動かす。
 * @param scenario.start: 開始する local 時刻（[年, 月(0 始まり), 日, 時, 分]）
 * @param scenario.ranges: encodeSuspendTimes
 * @param scenario.concurrentEncodeNum: 同時実行数
 * @param scenario.steps: 実時間の経過（分）ごとに行う操作。`push` は依頼を一件積み、`observe` は開始状態を記録する
 */
const runScenario = async scenario => {
    const [year, month, date, hours, minutes] = scenario.start;
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date(year, month, date, hours, minutes).getTime() });
    const logger = { encode: { error: () => undefined, info: () => undefined, warn: () => undefined } };
    const created = [];
    const manage = new EncodeManageModel(
        { getLogger: () => logger },
        {
            getConfig: () => ({
                concurrentEncodeNum: scenario.concurrentEncodeNum,
                encodeSuspendTimes: scenario.ranges,
            }),
        },
        { getExecution: async () => 'synthetic-dst-execution', unLockExecution: () => undefined },
        async () => {
            const item = makeEncoder();
            created.push(item);

            return item;
        },
        new EncodeEvent({ getLogger: () => logger }),
    );
    const observations = [];
    let elapsedMs = 0;
    try {
        for (const step of scenario.steps) {
            // 1 秒ずつ進め、timer が期限の時刻の Date で発火するようにする
            while (elapsedMs < step.atMinutes * 60 * 1000) {
                mock.timers.tick(STEP_MS);
                elapsedMs += STEP_MS;
                await flushEventLoop();
            }
            if (step.action === 'push') {
                await manage.push(option(9000 + created.length));
                await flushEventLoop();
            } else {
                observations.push({
                    atMinutes: step.atMinutes,
                    wallClock: wallClock(),
                    started: created.map(item => item.started),
                });
            }
        }
    } finally {
        manage.listener.removeAllListeners();
        mock.timers.reset();
    }

    return observations;
};

const scenarios = JSON.parse(process.env.SUSPEND_DST_SCENARIOS);
const results = {};
for (const [name, scenario] of Object.entries(scenarios)) {
    results[name] = await runScenario(scenario);
}
process.stdout.write(JSON.stringify(results));
