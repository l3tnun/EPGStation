import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { compiledSnapshotRoot } from '../_runtime-harness';

type Identity =
    | { readonly status: 'running'; readonly startTime: string }
    | { readonly status: 'zombie' }
    | { readonly status: 'absent' }
    | { readonly status: 'unavailable' };

interface ProcessSystem {
    identify(pid: number): Identity;
    isAlive(pid: number): boolean;
    hasLiveGroupMember(pgid: number): boolean | undefined;
    signal(pid: number, signal: NodeJS.Signals): void;
    isGroupAlive(pgid: number): boolean;
    signalGroup(pgid: number, signal: NodeJS.Signals): void;
    wait(milliseconds: number): Promise<void>;
    removeFile(filePath: string): Promise<void>;
}

const moduleRequire = createRequire(join(process.cwd(), 'package.json'));
const systemModule = moduleRequire(join(compiledSnapshotRoot(), 'model', 'ServiceChildProcessSystem.js')) as {
    createProcessSystem(
        platform: NodeJS.Platform,
        readFile: (path: string, encoding: 'utf8') => string,
        readDir?: (path: string) => string[],
    ): ProcessSystem;
    nodeProcessSystem: ProcessSystem;
    removeFileIfPresent(filePath: string): Promise<void>;
};

const statLine = (state: string, startTime: string, pgrp = 4242): string =>
    // pid (comm with a space and a parenthesis) state ppid pgrp ... field 22 is the start time.
    `4242 (synthetic (worker) x) ${state} 1 ${pgrp} 4242 0 -1 4194560 0 0 0 0 0 0 0 0 20 0 1 0 ${startTime} 1000 10 0\n`;

const errorWithCode = (code: string): Error => Object.assign(new Error(code), { code });

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('ServiceChildProcessSystem', () => {
    it('[AR-9.4] reads the start time and the zombie state from the Linux process status line', () => {
        const lines = new Map<string, string>([
            ['/proc/4242/stat', statLine('S', '123456')],
            ['/proc/4243/stat', statLine('Z', '123457')],
            ['/proc/4244/stat', statLine('X', '123458')],
            ['/proc/4245/stat', 'garbage'],
            ['/proc/4246/stat', statLine('R', 'not-a-number')],
        ]);
        const system = systemModule.createProcessSystem('linux', path => {
            const line = lines.get(path);
            if (path.includes('4249')) throw 'synthetic thrown text';
            if (line === undefined) throw errorWithCode(path.includes('4247') ? 'EACCES' : 'ENOENT');
            return line;
        });

        expect(system.identify(4242)).toEqual({ startTime: '123456', status: 'running' });
        expect(system.identify(4243)).toEqual({ status: 'zombie' });
        expect(system.identify(4244)).toEqual({ status: 'zombie' });
        expect(system.identify(4245)).toEqual({ status: 'unavailable' });
        expect(system.identify(4246)).toEqual({ status: 'unavailable' });
        expect(system.identify(4247)).toEqual({ status: 'unavailable' });
        expect(system.identify(4248)).toEqual({ status: 'absent' });
        expect(system.identify(4249)).toEqual({ status: 'unavailable' });
    });

    it('[AR-8.9] finds a live member of a process group and ignores zombie members and other groups', () => {
        const lines = new Map<string, string>([
            ['/proc/5001/stat', statLine('Z', '1', 5000)],
            ['/proc/5002/stat', statLine('X', '1', 5000)],
            ['/proc/5003/stat', statLine('S', '1', 5100)],
            ['/proc/5004/stat', statLine('S', '1', 5200)],
        ]);
        const readDir = vi.fn(() => ['self', '5001', '5002', '5003', '5004', '5005']);
        const system = systemModule.createProcessSystem(
            'linux',
            path => {
                const line = lines.get(path);
                if (line === undefined) throw errorWithCode('ENOENT');
                return line;
            },
            readDir,
        );

        expect(system.hasLiveGroupMember(5000)).toBe(false);
        expect(system.hasLiveGroupMember(5100)).toBe(true);
        expect(system.hasLiveGroupMember(5200)).toBe(true);
        expect(readDir).toHaveBeenCalledWith('/proc');
    });

    it('[AR-8.9] reports group membership as unreadable outside Linux or when /proc cannot be listed', () => {
        const readDir = vi.fn(() => {
            throw errorWithCode('EACCES');
        });
        const linux = systemModule.createProcessSystem('linux', () => statLine('S', '1'), readDir);
        const windows = systemModule.createProcessSystem('win32', () => statLine('S', '1'), readDir);

        expect(linux.hasLiveGroupMember(4242)).toBeUndefined();
        expect(windows.hasLiveGroupMember(4242)).toBeUndefined();
        expect(readDir).toHaveBeenCalledOnce();
        // The test process itself is a live member of its own process group (field 5 of /proc/self/stat).
        const selfStat = readFileSync('/proc/self/stat', 'utf8');
        const ownGroup = Number(selfStat.slice(selfStat.lastIndexOf(')') + 2).split(' ')[2]);
        expect(systemModule.nodeProcessSystem.hasLiveGroupMember(ownGroup)).toBe(true);
    });

    it('[AR-9.4] reports the start time as unavailable outside Linux without reading anything', () => {
        const readFile = vi.fn(() => statLine('S', '1'));
        const system = systemModule.createProcessSystem('win32', readFile);

        expect(system.identify(4242)).toEqual({ status: 'unavailable' });
        expect(readFile).not.toHaveBeenCalled();
    });

    it('[AR-9.4] identifies the running test process through the default system', () => {
        const identity = systemModule.nodeProcessSystem.identify(process.pid);

        expect(['running', 'unavailable']).toContain(identity.status);
        expect(systemModule.nodeProcessSystem.isAlive(process.pid)).toBe(true);
    });

    it('[AR-9.4] treats ESRCH as gone and any other probe error as alive', () => {
        const kill = vi.spyOn(process, 'kill');
        kill.mockImplementationOnce(() => {
            throw errorWithCode('ESRCH');
        });
        kill.mockImplementationOnce(() => {
            throw errorWithCode('EPERM');
        });

        expect(systemModule.nodeProcessSystem.isAlive(4251)).toBe(false);
        expect(systemModule.nodeProcessSystem.isAlive(4252)).toBe(true);
        expect(kill.mock.calls).toEqual([
            [4251, 0],
            [4252, 0],
        ]);
    });

    it('[AR-9.4] sends signals to a PID and to a process group and probes the group', () => {
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

        systemModule.nodeProcessSystem.signal(4261, 'SIGINT');
        systemModule.nodeProcessSystem.signalGroup(4262, 'SIGKILL');
        expect(systemModule.nodeProcessSystem.isGroupAlive(4263)).toBe(true);

        expect(kill.mock.calls).toEqual([
            [4261, 'SIGINT'],
            [-4262, 'SIGKILL'],
            [-4263, 0],
        ]);
    });

    it('[AR-9.4] waits with a timer and removes a file', async () => {
        vi.useFakeTimers();
        let waited = false;
        const wait = systemModule.nodeProcessSystem.wait(1_000).then(() => {
            waited = true;
        });
        await vi.advanceTimersByTimeAsync(999);
        expect(waited).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await wait;
        vi.useRealTimers();

        const directory = mkdtempSync(join(tmpdir(), 'epgstation-process-system-'));
        try {
            const filePath = join(directory, 'synthetic-output.mp4');
            writeFileSync(filePath, 'synthetic');
            await systemModule.nodeProcessSystem.removeFile(filePath);
            expect(existsSync(filePath)).toBe(false);
            await expect(systemModule.removeFileIfPresent(filePath)).resolves.toBeUndefined();
            await expect(systemModule.removeFileIfPresent(directory)).rejects.toMatchObject({
                code: expect.stringMatching(/^(EISDIR|EPERM)$/u),
            });
        } finally {
            rmSync(directory, { force: true, recursive: true });
        }
    });
});
