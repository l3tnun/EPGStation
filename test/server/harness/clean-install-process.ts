import { spawn } from 'node:child_process';

/*
 * clean な directory で本物の `npm ci`・`npm run compile`・`node -e` を子 process として流す helper。
 * 子 process の期限は「止まった process を打ち切る」ためのもので、正常な所要時間（数秒）より十分長い。
 * 他の重い test と並行すると所要時間が伸びるため、この helper を使う test file は直列実行の一覧に載せる。
 */
export const cleanInstallChildTimeoutMs = 20_000;
export const cleanInstallChildTerminationGraceMs = 1_000;
const cleanInstallProbeCleanupAllowanceMs = 8_000;
export const cleanInstallProbeTimeoutMs =
    2 * (cleanInstallChildTimeoutMs + cleanInstallChildTerminationGraceMs) + cleanInstallProbeCleanupAllowanceMs;

const isCleanInstallEnvironmentFailure = (args: readonly string[], output: string) =>
    args[0] === 'ci' &&
    /\bnpm error code (?:EAI_AGAIN|ECONN(?:REFUSED|RESET)|ENET(?:DOWN|UNREACH)|ENOTCACHED|ENOTFOUND|ETIMEDOUT)\b/iu.test(
        output,
    );

export const runNpm = (
    cwd: string,
    args: readonly string[],
    {
        spawnNpm = spawn,
        terminationGraceMs = cleanInstallChildTerminationGraceMs,
        timeoutMs = cleanInstallChildTimeoutMs,
    }: {
        readonly spawnNpm?: typeof spawn;
        readonly terminationGraceMs?: number;
        readonly timeoutMs?: number;
    } = {},
): Promise<string> =>
    new Promise((resolve, reject) => {
        const npmCli = process.env.npm_execpath;
        if (npmCli === undefined) {
            reject(new Error('The npm CLI path is required for the clean-install probe'));
            return;
        }
        const child = spawnNpm(process.execPath, [npmCli, ...args], {
            cwd,
            env: {
                ...process.env,
                npm_config_audit: 'false',
                npm_config_fund: 'false',
                npm_config_progress: 'false',
                npm_config_update_notifier: 'false',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        let timedOut = false;
        let terminationGrace: NodeJS.Timeout | undefined;
        const deadline = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            terminationGrace = setTimeout(() => child.kill('SIGKILL'), terminationGraceMs);
        }, timeoutMs);
        const clearDeadlines = () => {
            clearTimeout(deadline);
            if (terminationGrace !== undefined) clearTimeout(terminationGrace);
        };
        child.stdout?.on('data', chunk => {
            output += String(chunk);
        });
        child.stderr?.on('data', chunk => {
            output += String(chunk);
        });
        child.once('error', error => {
            if (timedOut) return;
            clearDeadlines();
            reject(error);
        });
        child.once('close', (code, signal) => {
            clearDeadlines();
            if (timedOut) {
                reject(
                    new Error(
                        `clean-install environment timeout after ${timeoutMs}ms: npm ${args.join(' ')} closed with ${
                            signal ?? `exit code ${code}`
                        }`,
                    ),
                );
            } else if (code === 0) {
                resolve(output);
            } else {
                const category = isCleanInstallEnvironmentFailure(args, output)
                    ? 'clean-install environment failure'
                    : 'clean-install product regression';
                reject(new Error(`${category}: npm ${args.join(' ')} failed with exit code ${code}: ${output}`));
            }
        });
    });

export const runNode = (cwd: string, source: string): Promise<string> =>
    new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', source], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let standardOutput = '';
        let standardError = '';
        child.stdout?.on('data', chunk => {
            standardOutput += String(chunk);
        });
        child.stderr?.on('data', chunk => {
            standardError += String(chunk);
        });
        child.once('error', reject);
        child.once('close', code => {
            if (code === 0) resolve(standardOutput);
            else reject(new Error(`node import-graph probe failed with exit code ${code}: ${standardError}`));
        });
    });
