import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withCompiledSnapshot } from '../../../scripts/server-test/compiled-snapshot.mjs';

interface ChildResult {
    readonly exitCode: number | null;
    readonly stderr: string;
    readonly stdout: string;
}

function runNodeScript(script: string, cwd: string): Promise<ChildResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', script], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => {
            stdout += chunk;
        });
        child.stderr.on('data', chunk => {
            stderr += chunk;
        });
        child.on('error', reject);
        child.on('close', code => resolve({ exitCode: code, stdout, stderr }));
    });
}

// Proves the precondition the production guard/export (src/DBTools.ts / src/V1MigrationTool.ts)
// establishes -- that requiring the real, unmodified compiled entry does not self-start and yields the
// class handle at `.default`. Runs as a real child process (no argv, no dependency substitution) because
// without the guard, requiring the entry unconditionally constructs the tool and calls `process.exit` from
// its constructor, which would kill the test runner itself if required in-process.
describe('management tool compiled entrypoints — require without self-start ', () => {
    // The 15s budget below is the require-and-assert check, not snapshot acquisition.
    // `withCompiledSnapshot` → `getOrBuildCachedDist` validates every sibling cache
    // entry (hash of each dist file). Measured on a warm cache with 89 entries:
    // 6455ms before any require. Under the integration suite that exceeded 15s, so
    // both cases timed out at the it.each callback before the first expect, while
    // the same require passed in a coverage run in 2263ms and 1590ms. Acquire the
    // snapshot once here. A slow build still fails this hook; it is not a skip.
    let compiledSnapshot = '';
    let releaseSnapshot: () => void = () => undefined;
    let snapshotDone: Promise<void> = Promise.resolve();

    beforeAll(async () => {
        let markReady: (snapshot: string) => void = () => undefined;
        let markFailed: (error: unknown) => void = () => undefined;
        const ready = new Promise<string>((resolve, reject) => {
            markReady = resolve;
            markFailed = reject;
        });
        let release: () => void = () => undefined;
        const released = new Promise<void>(resolve => {
            release = resolve;
        });
        releaseSnapshot = () => release();
        snapshotDone = withCompiledSnapshot(async snapshot => {
            markReady(snapshot);
            await released;
        }).then(
            () => undefined,
            error => {
                markFailed(error);
                throw error;
            },
        );
        compiledSnapshot = await ready;
    }, 180_000);

    afterAll(async () => {
        releaseSnapshot();
        await snapshotDone;
    });

    it.each(['DBTools.js', 'V1MigrationTool.js'] as const)(
        'requires the real compiled %s without self-starting and exposes .default as the class handle',
        async filename => {
            const entryPath = join(compiledSnapshot, filename);
            const script = [
                `const mod = require(${JSON.stringify(entryPath)});`,
                "process.stdout.write('required:ok\\n');",
                "process.stdout.write('default-type:' + typeof mod.default + '\\n');",
                "process.stdout.write('default-is-class:' + (typeof mod.default === 'function' && /^class[\\s{]/.test(mod.default.toString())) + '\\n');",
            ].join('\n');

            const { exitCode, stdout, stderr } = await runNodeScript(script, compiledSnapshot);

            // Node 26 prints an ExperimentalWarning when a dependency probes the global
            // `localStorage` without `--localstorage-file`; that is runtime noise, not output
            // of a self-started entrypoint, so only non-warning stderr must be empty.
            const stderrWithoutRuntimeWarnings = stderr
                .split('\n')
                .filter(
                    line =>
                        !/^\(node:\d+\) ExperimentalWarning: /u.test(line) &&
                        !/^\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)$/u.test(line),
                )
                .join('\n');
            expect(stderrWithoutRuntimeWarnings).toBe('');
            expect(exitCode).toBe(0);
            expect(stdout).toContain('required:ok');
            expect(stdout).toContain('default-type:function');
            expect(stdout).toContain('default-is-class:true');
        },
        15_000,
    );
});
