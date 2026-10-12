import { spawn } from 'node:child_process';

export function run(command, arguments_, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, arguments_, {
            cwd: options.cwd ?? process.cwd(),
            env: options.env ?? process.env,
            shell: false,
            stdio: 'inherit',
        });
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (signal !== null) {
                reject(new Error(`${command} terminated by ${signal}`));
                return;
            }
            if (code !== 0) {
                reject(
                    Object.assign(new Error(`${command} exited with status ${code ?? 'unknown'}`), { exitCode: code }),
                );
                return;
            }
            resolve();
        });
    });
}

export async function main(action) {
    try {
        await action();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
