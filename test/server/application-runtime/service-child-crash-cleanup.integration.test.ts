import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    healthyTunerHandler,
    reserveUnusedPort,
    startOperator,
    startTunerStub,
    waitFor,
    type OperatorHandle,
    type TunerStub,
} from '../harness/real-operator';

/**
 * Web・API 側処理（子）が SIGKILL で終了したときの管理側（親）の後始末を、実際の process で確かめる
 * （Requirement 8 Acceptance Criteria 2、8〜11）。親は compile 済みの Operator そのもので、子の入口だけを差し替える。
 * 一世代目の子は、依頼記録窓口へ本物の IPC でエンコードの依頼と出力先を記録し、出力ファイルへ書き続ける偽の
 * エンコードと、`SIGINT` を無視して HLS 成果物を書き続ける偽の HLS writer（独立した process group）を起動して
 * 親へ知らせる。二世代目の子は、起動した時点で偽の process が残っていないか、ファイルが消えたかを記録する。
 */

const fakeEncodeSource = String.raw`
import { appendFileSync, writeFileSync } from 'node:fs';
const [output, marker] = process.argv.slice(2);
writeFileSync(output, 'partial');
process.on('SIGINT', () => {
    appendFileSync(marker, 'SIGINT\n');
    process.exit(0);
});
setInterval(() => appendFileSync(output, 'x'), 50);
`;

const fakeHlsWriterSource = String.raw`
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [directory, marker] = process.argv.slice(2);
process.on('SIGINT', () => appendFileSync(marker, 'SIGINT\n'));
writeFileSync(join(directory, 'stream5.m3u8'), '#EXTM3U\n');
let segment = 0;
setInterval(() => {
    segment += 1;
    writeFileSync(join(directory, 'stream5-' + String(segment).padStart(9, '0') + '.ts'), 'x');
}, 50);
`;

const serviceExecutorSource = String.raw`
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../../../', import.meta.url);
const at = name => fileURLToPath(new URL(name, root));
const isRunning = pid => {
    try {
        const stat = readFileSync('/proc/' + pid + '/stat', 'utf8');
        return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
    } catch {
        return false;
    }
};
if (existsSync(at('service-generation'))) {
    const first = JSON.parse(readFileSync(at('first-generation.json'), 'utf8'));
    writeFileSync(
        at('second-generation.json'),
        JSON.stringify({
            encodeRunning: isRunning(first.encodePid),
            hlsRunning: isRunning(first.hlsPid),
            outputExists: existsSync(first.outputPath),
            streamFiles: readdirSync(at('streamfiles')),
        }),
    );
} else {
    writeFileSync(at('service-generation'), 'first');
    let nextId = 1;
    const pending = new Map();
    process.on('message', message => {
        const waiter = pending.get(message?.id);
        if (waiter === undefined) return;
        pending.delete(message.id);
        if (typeof message.error === 'string') waiter.reject(new Error(message.error));
        else waiter.resolve(message.result);
    });
    const request = (model, func, args) =>
        new Promise((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { reject, resolve });
            process.send({ args, func, id, model });
        });
    // The output deletion follows the restoration rule, so the recorded program and its source file must exist.
    const recordedId = await request('recorded', 'createNewRecorded', {
        option: { channelId: 1, endAt: 2_000, name: 'synthetic-recorded', startAt: 1_000 },
    });
    writeFileSync(at('recorded/synthetic-source.ts'), 'synthetic source');
    const sourceVideoFileId = await request('recorded', 'addVideoFile', {
        option: { filePath: 'synthetic-source.ts', name: 'synthetic-source', parentDirectoryName: 'synthetic', recordedId, type: 'ts' },
    });
    const encodeId = await request('encodeQueue', 'add', {
        option: { mode: 'synthetic-mode', parentDir: 'synthetic', recordedId, removeOriginal: false, sourceVideoFileId },
        requestToken: 'synthetic-request-token',
    });
    const outputPath = at('recorded/synthetic-output.mp4');
    await request('encodeQueue', 'updateOutputPath', { encodeId, outputPath });
    writeFileSync(at('fake-encode.mjs'), ${JSON.stringify(fakeEncodeSource)});
    writeFileSync(at('fake-hls-writer.mjs'), ${JSON.stringify(fakeHlsWriterSource)});
    const encode = spawn(process.execPath, [at('fake-encode.mjs'), outputPath, at('encode-sigint.log')], { stdio: 'ignore' });
    const hls = spawn(process.execPath, [at('fake-hls-writer.mjs'), at('streamfiles'), at('hls-sigint.log')], {
        detached: true,
        stdio: 'ignore',
    });
    await Promise.all([once(encode, 'spawn'), once(hls, 'spawn')]);
    process.send({ encodeId, kind: 'encode', pid: encode.pid, type: 'serviceProcessStarted' });
    process.send({ kind: 'hls', pgid: hls.pid, pid: hls.pid, streamId: 5, type: 'serviceProcessStarted' });
    while (!existsSync(outputPath) || !readdirSync(at('streamfiles')).some(name => name.endsWith('.ts'))) {
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    writeFileSync(at('first-generation.json'), JSON.stringify({ encodePid: encode.pid, hlsPid: hls.pid, outputPath }));
}
setInterval(() => undefined, 1_000_000);
`;

const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

const forceKill = (pid: unknown, group: boolean): void => {
    if (typeof pid !== 'number') return;
    try {
        process.kill(group ? -pid : pid, 'SIGKILL');
    } catch {
        // Already gone, which is the expected outcome.
    }
};

describe('[AR-8.8][AR-8.9][AR-8.10] the processes of a SIGKILLed service child (real process)', () => {
    it('stops the reported encode and HLS writer, deletes their files, and only then starts a new service child', async () => {
        const stub: TunerStub = await startTunerStub(
            healthyTunerHandler([{ index: 0, name: 'synthetic-tuner-0', types: ['GR'] }]),
        );
        let operator: OperatorHandle | undefined;
        let first: Record<string, unknown> = {};
        try {
            operator = await startOperator({
                serviceExecutorSource,
                servicePort: await reserveUnusedPort(),
                tunerPort: stub.port,
            });
            const root = operator.root;
            const diagnostics = () => operator?.diagnostics();
            await waitFor(() => existsSync(join(root, 'first-generation.json')), 'the first service child', diagnostics);
            first = readJson(join(root, 'first-generation.json'));
            const [servicePid] = operator.servicePids();

            process.kill(servicePid, 'SIGKILL');
            await waitFor(() => existsSync(join(root, 'second-generation.json')), 'the second service child', diagnostics);

            expect(operator.servicePids()).toHaveLength(2);
            expect(readJson(join(root, 'second-generation.json'))).toEqual({
                encodeRunning: false,
                hlsRunning: false,
                outputExists: false,
                streamFiles: [],
            });
            expect(readFileSync(join(root, 'encode-sigint.log'), 'utf8')).toBe('SIGINT\n');
            expect(readFileSync(join(root, 'hls-sigint.log'), 'utf8')).toBe('SIGINT\n');
            const systemLog = await operator.readSystemLog();
            expect(systemLog).toContain('service process exit code: null, signal: SIGKILL');
            expect(systemLog.indexOf('service process exit code: null, signal: SIGKILL')).toBeLessThan(
                systemLog.indexOf('restart service'),
            );
            // Every stopped process is confirmed gone (a zombie-only group counts as ended), so no unconfirmed stop and
            // no cap is recorded.
            expect(systemLog).not.toContain('terminalConfirmed');
            expect(systemLog).not.toContain('did not finish within');
            expect(await readFile(join(root, 'service-generation'), 'utf8')).toBe('first');
        } finally {
            forceKill(first.encodePid, false);
            forceKill(first.hlsPid, true);
            await operator?.stop();
            await stub.close();
        }
    }, 120_000);
});
