import { execFile } from 'node:child_process';
import { join } from 'node:path';

/**
 * 本物の ffmpeg・ffprobe を使う結合 test のための、合成の極小の動画を作る補助。
 * 入力は ffmpeg の lavfi（testsrc・sine）だけで、実在の放送・番組の data を含まない。
 * ffmpeg・ffprobe は PATH から探す（test の前提。docs/testing.md）。
 */

export const FFMPEG = 'ffmpeg';
export const FFPROBE = 'ffprobe';

export interface ProcessResult {
    readonly stdout: string;
    readonly stderr: string;
}

export const runProcess = (
    command: string,
    arguments_: readonly string[],
    timeoutMs = 60_000,
): Promise<ProcessResult> =>
    new Promise((resolve, reject) => {
        execFile(command, arguments_, { maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs }, (error, stdout, stderr) => {
            if (error !== null) {
                reject(Object.assign(new Error(`${command} failed: ${stderr.slice(-2_000)}`), { cause: error }));
                return;
            }
            resolve({ stdout, stderr });
        });
    });

export type SyntheticMediaKind = 'mpegts' | 'mp4' | 'mpegts-video-only';

const encodeArguments: Record<SyntheticMediaKind, readonly string[]> = {
    mpegts: ['-c:v', 'mpeg2video', '-c:a', 'aac', '-f', 'mpegts'],
    mp4: ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mp4'],
    'mpegts-video-only': ['-an', '-c:v', 'mpeg2video', '-f', 'mpegts'],
};

/**
 * `seconds` 秒の合成の動画を `directory/name` に作り、その path を返す。
 */
export const createSyntheticMedia = async (
    directory: string,
    name: string,
    kind: SyntheticMediaKind,
    seconds = 2,
): Promise<string> => {
    const output = join(directory, name);
    await runProcess(FFMPEG, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc=duration=${seconds}:size=160x120:rate=30`,
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=440:duration=${seconds}`,
        ...encodeArguments[kind],
        output,
    ]);
    return output;
};
