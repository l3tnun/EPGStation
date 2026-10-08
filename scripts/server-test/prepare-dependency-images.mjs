#!/usr/bin/env node
/**
 * Docker image の確認の依存 image を手元に揃える、本体の前の専用 step。
 *
 *   node scripts/server-test/prepare-dependency-images.mjs
 *
 * 外部への取得（base image の pull、OS の package、npm の依存関係）はこの step だけが行う。
 * 確認の本体は取得せず、ここが用意した image が無ければ「準備されていない」として失敗する。必要な image がすべて手元にあれば、`docker image inspect`
 * を数回呼ぶだけで終わる。
 *
 * 終了 code:
 *   0   すべて手元にある（必要なら取得して揃えた）
 *   75  取得の失敗（決まった回数と時間のうちに取得できなかった。標準エラーに
 *       `dependency-images-fetch-failed` と対象を出す）。確認の失敗ではない。
 *   2   入力の誤り（Dockerfile の digest が決まらないなど）
 *   1   想定外の失敗
 *
 * 取得の試行回数と、試行ごとの上限時間は `dependency-images.mjs` が固定する。
 * `EPGS_DEPS_PREPARE_RETRY_DELAY_MS`（0 以上 15000 以下の整数）は試行の間隔を短くする
 * ためだけにあり、延ばせない。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
    DependencyFetchError,
    DependencyImagePlanError,
    FETCH_RETRY_DELAY_MS,
    prepareDependencyImages,
} from './dependency-images.mjs';

export const EXIT_FETCH_FAILED = 75;
export const EXIT_INVALID_INPUT = 2;

function run(argv, { timeoutMs }) {
    return new Promise(resolve => {
        const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, timeoutMs);
        child.stdout.on('data', chunk => {
            stdout += String(chunk);
        });
        child.stderr.on('data', chunk => {
            stderr += String(chunk);
        });
        child.on('error', error => {
            clearTimeout(timer);
            resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` });
        });
        child.on('close', code => {
            clearTimeout(timer);
            resolve({ code: timedOut ? null : code, stdout, stderr });
        });
    });
}

function retryDelayMs(env) {
    const raw = env.EPGS_DEPS_PREPARE_RETRY_DELAY_MS;
    if (raw === undefined || raw === '') {
        return FETCH_RETRY_DELAY_MS;
    }
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 && value <= FETCH_RETRY_DELAY_MS ? value : FETCH_RETRY_DELAY_MS;
}

export async function main({ root, env = process.env, out = process.stdout, err = process.stderr } = {}) {
    const repositoryRoot = root ?? fileURLToPath(new URL('../../', import.meta.url));
    const log = line => out.write(`${line}\n`);
    try {
        const report = await prepareDependencyImages({
            root: repositoryRoot,
            run,
            sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
            log,
            delayMs: retryDelayMs(env),
        });
        log(
            `deps-prepare: ready (present=${report.present.length} pulled=${report.pulled.length} built=${report.built.length})`,
        );
        for (const name of [...report.pulled, ...report.built]) {
            log(`deps-prepare: fetched ${name}`);
        }
        return 0;
    } catch (error) {
        if (error instanceof DependencyFetchError) {
            err.write(`deps-prepare: FETCH-FAILED ${error.reason} ${error.what}: ${error.detail}\n`);
            return EXIT_FETCH_FAILED;
        }
        if (error instanceof DependencyImagePlanError) {
            err.write(`deps-prepare: INVALID-INPUT ${error.reason} ${error.message}\n`);
            return EXIT_INVALID_INPUT;
        }
        err.write(`deps-prepare: ERROR ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
        return 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exitCode = await main();
}
