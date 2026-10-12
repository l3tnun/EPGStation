import 'reflect-metadata';

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiled } from './_media-harness';
import { cleanupStacks, makeStack, registryOf, startAndWaitForArtifacts } from './_real-hls-stack';

/*
 * 終了を確認できない HLS writer の停止を、実際に起動した writer の process group・本物の `EncodeProcessManageModel`・
 * `StreamManageModel`・実の log4js（`LoggerModel`）の出力 file で確かめる。root なしでは「SIGKILL でも消えない group」
 * や「signal を送れない group」を OS が作ってくれないので、`process.kill` の呼び出しだけを差し込みで変える
 * （group は実在し、signal 0 の生存確認は本物へ通す）。
 *  - 握りつぶし: 非 0 の signal を group へ届けない（SIGKILL を受けても消えない group と同じに見える）。
 *  - 失敗: 非 0 の signal を送ろうとすると EPERM で失敗する（別 UID の group と同じ結果）。
 *  - 確認の失敗: signal 0 の生存確認が EPERM で失敗する。
 */

const LoggerModel = compiled<{ default: new () => { getLogger(): any; initialize(filePath?: string): void } }>(
    'model',
    'LoggerModel.js',
).default;

const originalKill = process.kill;
const leftoverPids = new Set<number>();
const roots: string[] = [];

type Decision = 'pass' | 'swallow' | Error;

interface SignalCall {
    readonly at: number;
    readonly pid: number;
    readonly signal: unknown;
}

const interposeKill = (decide: (pid: number, signal: unknown) => Decision) => {
    const calls: SignalCall[] = [];
    process.kill = ((pid: number, signal?: string | number) => {
        if (pid < 0 && signal !== 0 && signal !== undefined) calls.push({ at: Date.now(), pid, signal });
        const decision = decide(pid, signal);
        if (decision === 'swallow') return true;
        if (decision instanceof Error) throw decision;
        return originalKill.call(process, pid, signal as NodeJS.Signals);
    }) as typeof process.kill;
    return { calls, restore: () => void (process.kill = originalKill) };
};

const syntheticError = (code: string): Error => Object.assign(new Error(`synthetic ${code}`), { code });
const isGroupSignal = (pid: number, signal: unknown): boolean => pid < 0 && signal !== 0 && signal !== undefined;
const isAlive = (pid: number): boolean => {
    try {
        originalKill.call(process, pid, 0);
        return true;
    } catch {
        return false;
    }
};

afterEach(async () => {
    process.kill = originalKill;
    await cleanupStacks();
    for (const pid of leftoverPids) {
        try {
            originalKill.call(process, -pid, 'SIGKILL');
        } catch {
            // already gone
        }
    }
    leftoverPids.clear();
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

/** 運用 log を、category ごとの実 file へ出す実の `LoggerModel`。 */
const makeRealLogs = async () => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-hls-logs-'));
    roots.push(root);
    const files = {
        access: join(root, 'access.log'),
        encode: join(root, 'encode.log'),
        stream: join(root, 'stream.log'),
        system: join(root, 'system.log'),
    };
    const appender = (name: keyof typeof files): string =>
        [
            `  ${name}:`,
            '    type: file',
            `    filename: ${files[name]}`,
            '    layout: { type: pattern, pattern: "%p %m" }',
        ].join('\n');
    const configPath = join(root, 'log.yml');
    await writeFile(
        configPath,
        [
            'appenders:',
            ...(['access', 'encode', 'stream', 'system'] as const).map(appender),
            'categories:',
            '  default: { appenders: [system], level: info }',
            ...(['access', 'encode', 'stream', 'system'] as const).map(
                name => `  ${name}: { appenders: [${name}], level: info }`,
            ),
        ].join('\n'),
    );
    const loggerModel = new LoggerModel();
    loggerModel.initialize(configPath);
    const read = async (name: keyof typeof files): Promise<string> =>
        (await readFile(files[name], 'utf8').catch(() => '')).replace(/\s+/gu, ' ');
    const waitFor = async (name: keyof typeof files, text: string): Promise<string> => {
        await vi.waitFor(async () => expect(await read(name)).toContain(text), { interval: 20, timeout: 10_000 });
        return read(name);
    };
    return { loggerModel, read, waitFor };
};

const startWriter = async (stack: Awaited<ReturnType<typeof makeStack>>) => {
    const streamId = await startAndWaitForArtifacts(stack);
    const [writer] = registryOf(stack.processManager) as Array<{ pid: number }>;
    leftoverPids.add(writer.pid);
    return { streamId, writerPid: writer.pid };
};

const count = (text: string, fragment: string): number => text.split(fragment).length - 1;

describe('HLS stop when the writer group cannot be confirmed gone, against a real writer group and real log files', () => {
    it('[MP-6.4][MP-6.5][MD-5.8] releases the slot about six seconds after an ineffective SIGINT and SIGKILL, and records one forced release on the process side and the delivery side', async () => {
        const logs = await makeRealLogs();
        const stack = await makeStack({ createDirectory: true, loggerModel: logs.loggerModel });
        const { streamId, writerPid } = await startWriter(stack);
        const kill = interposeKill((pid, signal) => (isGroupSignal(pid, signal) ? 'swallow' : 'pass'));

        const stopStartedAt = Date.now();
        await stack.manager.stop(streamId);
        const elapsed = Date.now() - stopStartedAt;
        kill.restore();

        // SIGINT の後 3 秒、SIGKILL の後 3 秒待ってから枠を解放する（それぞれ 1 回だけ送る）
        expect(elapsed).toBeGreaterThanOrEqual(5_900);
        expect(elapsed).toBeLessThan(20_000);
        expect(kill.calls.map(call => [call.pid, call.signal])).toEqual([
            [-writerPid, 'SIGINT'],
            [-writerPid, 'SIGKILL'],
        ]);
        expect(kill.calls[1].at - kill.calls[0].at).toBeGreaterThanOrEqual(2_900);
        expect(stack.manager.getStreamInfos()).toEqual([]);
        expect(registryOf(stack.processManager)).toEqual([]);
        expect(isAlive(writerPid)).toBe(true);

        // 解放された枠で、直後の HLS 開始が成功する（encodeProcessNum 1 のまま）
        const next = await startAndWaitForArtifacts(stack);
        expect(next).not.toBe(streamId);
        expect(registryOf(stack.processManager)).toHaveLength(1);

        // process 側: 1 件の error 行に、PID・PGID・種別・送った signal・終了未確認・枠の強制解放が入る
        const encodeText = await logs.waitFor('encode', 'forcedSlotRelease');
        expect(count(encodeText, 'forcedSlotRelease')).toBe(1);
        for (const fragment of [
            'ERROR',
            'forcedSlotRelease: true',
            "kind: 'hls-writer'",
            `pgid: ${writerPid}`,
            `pid: ${writerPid}`,
            "sentSignals: [ 'SIGINT', 'SIGKILL' ]",
            'terminalConfirmed: false',
        ]) {
            expect(encodeText).toContain(fragment);
        }

        // 配信側: 終了未確認・成果物の後始末・強制解放が 1 件の error 行に入る
        const streamText = await logs.waitFor('stream', 'hls-stop-finalization');
        expect(count(streamText, 'hls-stop-finalization')).toBe(1);
        for (const fragment of [
            "event: 'hls-stop-finalization'",
            'forceReleased: true',
            `streamId: ${streamId}`,
            "streamType: 'LiveHLS'",
            'exitConfirmed: false',
            'artifactCleanup',
        ]) {
            expect(streamText).toContain(fragment);
        }

        await stack.manager.stop(next);
    }, 60_000);

    it('[MP-6.11] force-releases once when signals cannot be sent, logs each failed stage, and sends no signal afterwards', async () => {
        const logs = await makeRealLogs();
        const stack = await makeStack({ createDirectory: true, loggerModel: logs.loggerModel });
        const { streamId, writerPid } = await startWriter(stack);
        const kill = interposeKill((pid, signal) => (isGroupSignal(pid, signal) ? syntheticError('EPERM') : 'pass'));

        await stack.manager.stop(streamId);

        expect(kill.calls.map(call => [call.pid, call.signal])).toEqual([
            [-writerPid, 'SIGINT'],
            [-writerPid, 'SIGKILL'],
        ]);
        expect(stack.manager.getStreamInfos()).toEqual([]);
        expect(registryOf(stack.processManager)).toEqual([]);
        const next = await startAndWaitForArtifacts(stack);
        expect(registryOf(stack.processManager)).toHaveLength(1);

        const encodeText = await logs.waitFor('encode', 'forcedSlotRelease');
        for (const stage of ['SIGINT-send', 'SIGKILL-send']) {
            expect(encodeText).toContain(`stage: '${stage}'`);
        }
        expect(encodeText).toContain("code: 'EPERM'");
        expect(count(encodeText, 'forcedSlotRelease')).toBe(1);
        expect(encodeText).toContain('sentSignals: []');
        expect(encodeText).toContain('terminalConfirmed: false');

        // 強制解放の後は、旧 group へ追加の signal を送らない
        await new Promise<void>(resolve => setTimeout(resolve, 1_500));
        expect(kill.calls).toHaveLength(2);
        expect(isAlive(writerPid)).toBe(true);
        kill.restore();
        await stack.manager.stop(next);
    }, 60_000);

    it('[MP-6.11] force-releases once when the liveness check itself fails, logs each failed stage, and does not treat the group as gone', async () => {
        const logs = await makeRealLogs();
        const stack = await makeStack({ createDirectory: true, loggerModel: logs.loggerModel });
        const { streamId, writerPid } = await startWriter(stack);
        // 生存確認（signal 0）が EPERM で失敗し、signal は group へ届かない（確認できない・届かない状態）
        const kill = interposeKill((pid, signal) => {
            if (pid < 0 && signal === 0) return syntheticError('EPERM');
            return isGroupSignal(pid, signal) ? 'swallow' : 'pass';
        });

        await stack.manager.stop(streamId);
        kill.restore();

        expect(kill.calls.map(call => [call.pid, call.signal])).toEqual([
            [-writerPid, 'SIGINT'],
            [-writerPid, 'SIGKILL'],
        ]);
        expect(stack.manager.getStreamInfos()).toEqual([]);
        expect(registryOf(stack.processManager)).toEqual([]);
        const encodeText = await logs.waitFor('encode', 'forcedSlotRelease');
        for (const stage of ['initial-check', 'SIGINT-check', 'SIGKILL-check']) {
            expect(encodeText).toContain(`stage: '${stage}'`);
        }
        expect(count(encodeText, "stage: 'SIGINT-check'")).toBe(3);
        expect(count(encodeText, "stage: 'SIGKILL-check'")).toBe(3);
        expect(count(encodeText, 'forcedSlotRelease')).toBe(1);
        expect(encodeText).toContain("sentSignals: [ 'SIGINT', 'SIGKILL' ]");
        expect(encodeText).toContain('terminalConfirmed: false');
        expect(encodeText).toContain(`pgid: ${writerPid}`);
        // 確認できなかっただけで、group は実在する（確認の失敗を「居ない」とはみなさない）
        expect(isAlive(writerPid)).toBe(true);
        const next = await startAndWaitForArtifacts(stack);
        expect(registryOf(stack.processManager)).toHaveLength(1);
        await stack.manager.stop(next);
    }, 60_000);
});
