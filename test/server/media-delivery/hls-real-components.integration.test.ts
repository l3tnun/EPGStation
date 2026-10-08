import 'reflect-metadata';

import { chmod, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupStacks, errorCalls, makeStack, registryOf, startAndWaitForArtifacts } from './_real-hls-stack';

/*
 * HLS 配信の後始末の test は、HLS 成果物の削除・走査を spy で失敗させ、writer と実行枠を偽物にしている。ここでは本物の
 * StreamManageModel・LiveHLSStreamModel・HLSFileDeleterModel・HlsStreamIdAllocator・EncodeProcessManageModel を、実 file
 * system の directory 権限（chmod）と、実際に起動した writer（node の script。process group として起動される）で動かし、
 * 保存先を作れない・読めない・消せない状況での扱いが、偽物のときと同じ結果になることを確かめる。
 */

afterEach(cleanupStacks);

describe('HLS delivery lifecycle against a real directory and a real writer group', () => {
    it('[MD-3.17] fails an HLS start while the real directory is unreadable, keeps other deliveries, and retries preparation on the next HLS start', async () => {
        const stack = await makeStack({ createDirectory: true, mode: 0o000 });

        await expect(stack.manager.start(stack.hlsModel())).rejects.toBeInstanceOf(Error);
        expect(registryOf(stack.processManager)).toEqual([]);
        expect(stack.logs.stream.fatal.mock.calls.length + stack.logs.stream.error.mock.calls.length).toBeGreaterThan(
            0,
        );

        // 非 HLS 配信と他の機能は止まらない。
        const directId = await stack.manager.start(stack.directModel());
        expect(stack.manager.getStreamInfos().map((info: { streamId: number }) => info.streamId)).toEqual([directId]);

        // 保存先が直った後の HLS 開始で、準備と走査が再試行されて成功する。
        await chmod(stack.streamRoot, 0o700);
        const streamId = await startAndWaitForArtifacts(stack);
        expect(streamId).not.toBe(directId);
        expect(registryOf(stack.processManager)).toHaveLength(1);

        await stack.manager.stop(streamId);
        await vi.waitFor(async () => expect(await readdir(stack.streamRoot)).toEqual([]), { timeout: 20_000 });
    }, 60_000);

    it('[MD-5.6][MD-5.7][MD-5.9][MP-6.8] records each undeletable artifact, force-releases the HLS identity, and frees the one execution slot although the artifacts stay', async () => {
        const stack = await makeStack({ createDirectory: true });
        const streamId = await startAndWaitForArtifacts(stack);
        const written = (await readdir(stack.streamRoot)).sort();
        expect(written).toEqual([`stream${streamId}-0.ts`, `stream${streamId}.m3u8`].sort());
        expect(registryOf(stack.processManager)).toHaveLength(1);

        // 実の unlink が失敗する成果物（中身のある directory。EISDIR）を、この配信の名前で置く。
        const undeletable = `stream${streamId}-undeletable`;
        await mkdir(join(stack.streamRoot, undeletable));
        await writeFile(join(stack.streamRoot, undeletable, 'inner'), 'synthetic-inner');
        await stack.manager.stop(streamId);

        // 配信一覧から外れ、論理実行枠は削除の失敗と無関係に解放されている。
        expect(stack.manager.getStreamInfos()).toEqual([]);
        expect(registryOf(stack.processManager)).toEqual([]);
        // 削除できなかった成果物が 3 回の試行ごとに、ファイル名・識別番号・試行回数・error つきで記録される。
        const unlinkFailures = errorCalls(stack.logs).filter(entry => entry?.operation === 'unlink');
        expect(unlinkFailures.map(entry => [entry.pass, entry.file])).toEqual(
            [1, 2, 3].map(pass => [pass, undeletable]),
        );
        for (const entry of unlinkFailures) {
            expect(entry.streamId).toBe(streamId);
            expect(entry.error).toMatchObject({ code: 'EISDIR' });
        }
        // 残った成果物・識別番号・試行回数・強制解放が 1 件の error ログに出る。
        const finalizations = errorCalls(stack.logs).filter(entry => entry?.event === 'hls-stop-finalization');
        expect(finalizations).toHaveLength(1);
        expect(finalizations[0]).toMatchObject({
            artifactCleanup: { passes: 3, remainingFiles: [undeletable], status: 'remaining' },
            forceReleased: true,
            streamId,
            streamType: 'LiveHLS',
        });
        // 消せた成果物は消え、消せなかったものは実際に残っている。
        expect(await readdir(stack.streamRoot)).toEqual([undeletable]);

        // 解放された枠は 1 つだけ使える（直後の HLS は始まり、同時の 2 本目は枠が無い）。
        const next = await startAndWaitForArtifacts(stack);
        expect(next).not.toBe(streamId);
        expect(registryOf(stack.processManager)).toHaveLength(1);
        await expect(stack.manager.start(stack.hlsModel())).rejects.toBeInstanceOf(Error);
        expect(registryOf(stack.processManager)).toHaveLength(1);
        await stack.manager.stop(next);
    }, 60_000);

    it('[MD-5.13][MD-5.9] reports an unreadable directory at stop as an unknown remaining state for every pass and still releases the identity and the slot', async () => {
        const stack = await makeStack({ createDirectory: true });
        const streamId = await startAndWaitForArtifacts(stack);
        const artifacts = (await readdir(stack.streamRoot)).sort();

        // 読めない directory（実の EACCES）にして停止する。走査・列挙・再走査が毎回失敗する。
        await chmod(stack.streamRoot, 0o300);
        await stack.manager.stop(streamId);

        expect(stack.manager.getStreamInfos()).toEqual([]);
        expect(registryOf(stack.processManager)).toEqual([]);
        const failures = errorCalls(stack.logs).filter(
            entry => entry?.streamId === streamId && typeof entry?.operation === 'string',
        );
        for (const operation of ['scan', 'list', 'rescan']) {
            expect(
                failures.filter(entry => entry.operation === operation).map(entry => entry.pass),
                operation,
            ).toEqual([1, 2, 3]);
        }
        for (const entry of failures) expect(entry.error).toMatchObject({ code: 'EACCES' });
        const finalizations = errorCalls(stack.logs).filter(entry => entry?.event === 'hls-stop-finalization');
        expect(finalizations).toHaveLength(1);
        expect(finalizations[0]).toMatchObject({
            artifactCleanup: { passes: 3, status: 'unknown' },
            forceReleased: true,
            streamId,
        });
        await chmod(stack.streamRoot, 0o700);
        expect((await readdir(stack.streamRoot)).sort()).toEqual(artifacts);
    }, 60_000);
});
