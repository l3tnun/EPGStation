import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 同梱の `config/enc-enhance.js.template` が、ffmpeg の進捗行から進捗の JSON を出すことの検査。
 *
 * ffmpeg は 7.0 から進捗行の size の単位を `kB` から `KiB` に変えた。本物の ffmpeg は使わず、
 * 進捗行を標準エラー出力へ出すだけの代用の ffmpeg を渡して template を実際に起動する。
 */
const progressLine = (size: string, time = '00:00:05.00'): string =>
    `frame= 5159 fps= 11 q=29.0 ${size} time=${time} bitrate=5845.8kbits/s dup=19 drop=0 speed=0.372x`;

const runTemplate = async (stderrLines: string[]): Promise<{ code: number | null; progress: unknown[] }> => {
    const root = await mkdtemp(join(tmpdir(), 'epgstation-enc-enhance-progress-'));
    try {
        const repositoryRoot = process.cwd();
        const packageType = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')).type;
        await writeFile(join(root, 'package.json'), `${JSON.stringify({ type: packageType })}\n`);
        const script = join(root, 'enc-enhance.js');
        await writeFile(script, await readFile(join(repositoryRoot, 'config/enc-enhance.js.template'), 'utf8'));
        // 動画の長さは 10 秒にする。
        const ffprobe = join(root, 'ffprobe');
        await writeFile(ffprobe, '#!/bin/sh\nprintf \'{"format":{"duration":"10.0"}}\'\n', { mode: 0o755 });
        const lines = join(root, 'stderr-lines.txt');
        await writeFile(lines, `${stderrLines.join('\n')}\n`);
        const ffmpeg = join(root, 'ffmpeg');
        await writeFile(ffmpeg, `#!/bin/sh\ncat '${lines}' >&2\n`, { mode: 0o755 });

        return await new Promise(resolve => {
            const child = spawn(process.execPath, [script], {
                cwd: repositoryRoot,
                env: {
                    ...process.env,
                    AUDIOCOMPONENTTYPE: '1',
                    FFMPEG: ffmpeg,
                    FFPROBE: ffprobe,
                    INPUT: '/dev/null',
                    OUTPUT: join(root, 'out.mp4'),
                    VIDEORESOLUTION: '720',
                },
                stdio: ['ignore', 'pipe', 'ignore'],
            });
            let stdout = '';
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', chunk => (stdout += chunk));
            child.once('close', code =>
                resolve({
                    code,
                    progress: stdout
                        .split('\n')
                        .filter(line => line !== '')
                        .map(line => JSON.parse(line)),
                }),
            );
        });
    } finally {
        await rm(root, { force: true, recursive: true });
    }
};

describe('[EN-SPEC-R4-3] enc-enhance.js.template の進捗行の解析', () => {
    it.each([
        ['ffmpeg 7.0 未満の kB', 'size=  122624kB', 122624],
        ['ffmpeg 7.0 以降の KiB', 'size=  122624KiB', 122624],
        ['最後の行の Lsize の kB', 'Lsize=     179kB', 179],
        ['最後の行の Lsize の KiB', 'Lsize=     179KiB', 179],
    ])('%s の行から進捗の JSON を出す', async (_name, sizeField, size) => {
        const result = await runTemplate([progressLine(sizeField)]);

        expect(result.code).toBe(0);
        expect(result.progress).toEqual([
            {
                type: 'progress',
                percent: 0.5,
                log: `frame= 5159 fps=11 size=${size} time=00:00:05.00 bitrate=5845.8 drop=0 speed=0.372`,
            },
        ]);
    });

    it('kB と KiB の行が混ざっていても、行ごとに進捗を出す', async () => {
        const result = await runTemplate([
            progressLine('size=  100kB', '00:00:02.00'),
            progressLine('size=  200KiB', '00:00:04.00'),
        ]);

        expect(result.progress).toEqual([
            expect.objectContaining({ percent: 0.2 }),
            expect.objectContaining({ percent: 0.4 }),
        ]);
    });

    it('size の単位が kB・KiB のどちらでもない行からは進捗を出さない', async () => {
        const result = await runTemplate([progressLine('size=  122624MB'), progressLine('size=  122624')]);

        expect(result.code).toBe(0);
        expect(result.progress).toEqual([]);
    });
});
