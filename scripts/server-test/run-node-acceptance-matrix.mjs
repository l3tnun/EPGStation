import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';

import { boundedNodeMatrixWorkerCount } from './node-matrix-worker-cap.mjs';
import { snapshotWorktreeContent } from './worktree-content.mjs';

/**
 * Each Node major runs its commands in its own fresh workspace.
 *
 * Node 24 (minimum supported): `npm ci`, `npm run build-server`, then two server-test commands, each
 * run once -- `run-coverage-gate-cli.mjs` (the unit tests, spec and imp, once with coverage; judges
 * C0/C1 == 100% over `src/**`) and `npm run test:server:integration` (the integration tests once,
 * without coverage). The cell fails when either fails.
 *
 * Node 26 (additional compatibility): `npm ci`, `npm run build-server`, and `npm run test:server`
 * (every server test once). No test runs twice in either cell.
 *
 * Node 26's `npm run test:server` does not run `docker-image.integration.test.ts`
 * (`EPGSTATION_TEST_SKIP_DOCKER_IMAGE_CHECK=1`, set by `nodeMatrixCommandEnv` for that major's server-test
 * command only): that file's real Docker image build and start already runs in Node 24's integration
 * command and standalone in the `docker-gate-node24` preflight step, and the image is not
 * Node-major-specific. `run-tests.mjs`'s whole-layer dispatch reads the variable.
 *
 * The result is published through this module's own atomic JSON write (`writeNodeAcceptanceArtifact`).
 *
 * - fresh workspace materializes the candidate tree before the fixed commands: the worktree's current content
 *   (uncommitted changes and non-ignored untracked files included) unless `--candidate <tree>` names one; the
 *   outcome never depends on HEAD or on uncommitted changes, and the artifact records `candidate`
 * - every path completes 24/26 cell terminal records (commands + reap + cleanup), publishes artifact,
 *   then fails closed on non-success; bothCellsTerminal is exact 2 cell records
 * - default adapters use real processes/workspaces; reap waits for close
 */

const execFile = promisify(execFileCallback);

export const NODE_MATRIX_MAJORS = Object.freeze([24, 26]);
// Shared first two commands; the server-test commands differ per major (the unit-test coverage gate plus
// the integration run on Node 24, the whole server suite on Node 26).
const NODE_MATRIX_COMMON_COMMANDS = Object.freeze(['npm ci', 'npm run build-server']);
export const NODE_MATRIX_COMMANDS_BY_MAJOR = Object.freeze({
    24: Object.freeze([
        ...NODE_MATRIX_COMMON_COMMANDS,
        'node scripts/server-test/run-coverage-gate-cli.mjs',
        'npm run test:server:integration',
    ]),
    26: Object.freeze([...NODE_MATRIX_COMMON_COMMANDS, 'npm run test:server']),
});

export function commandsForMajor(major) {
    const commands = NODE_MATRIX_COMMANDS_BY_MAJOR[major];
    if (commands === undefined) {
        fail('schema-mismatch', `no fixed commands defined for Node major ${major}`);
    }
    return commands;
}

/**
 * Env a node-matrix leg's server-test commands (every command after the common `npm ci` /
 * `npm run build-server`) run under. Every server-test command of both majors shares the same
 * `EPGSTATION_TEST_MAX_WORKERS` cap from `node-matrix-worker-cap.mjs` -- Node 24's
 * `run-coverage-gate-cli.mjs` also narrows itself internally via its own `boundedCoverageEnv`, but this
 * is what bounds Node 24's integration run and Node 26's plain `npm run test:server`, which have
 * nothing else capping them. `npm ci` / `npm run build-server` do not read this variable, so they run
 * under `baseEnv` unchanged.
 *
 * Node 26's server-test command additionally gets `EPGSTATION_TEST_SKIP_DOCKER_IMAGE_CHECK=1` (see this
 * module's own doc for why only that command). Node 24's commands never get it, so its integration
 * run still covers `docker-image.integration.test.ts`.
 */
export function nodeMatrixCommandEnv(major, command, baseEnv = process.env) {
    const isServerTestCommand = commandsForMajor(major)
        .slice(NODE_MATRIX_COMMON_COMMANDS.length)
        .includes(command);
    if (!isServerTestCommand) {
        return baseEnv;
    }
    return {
        ...baseEnv,
        EPGSTATION_TEST_MAX_WORKERS: String(boundedNodeMatrixWorkerCount(baseEnv)),
        ...(major === 26 ? { EPGSTATION_TEST_SKIP_DOCKER_IMAGE_CHECK: '1' } : {}),
    };
}

export const NODE_ACCEPTANCE_ARTIFACT_DIRECTORY_SEGMENTS = Object.freeze(['test', 'server', '.artifacts', 'evidence']);

/**
 * Atomically (create-exclusive temp file + fsync + rename) persists a JSON payload to
 * `test/server/.artifacts/evidence/<fileName>`, so a reader never observes a partially written
 * artifact. A failed write removes its temp file before the error propagates.
 */
export async function writeNodeAcceptanceArtifact(repositoryRoot, fileName, payload) {
    const directory = resolve(repositoryRoot, ...NODE_ACCEPTANCE_ARTIFACT_DIRECTORY_SEGMENTS);
    await mkdir(directory, { recursive: true });
    const target = join(directory, fileName);
    const temporary = join(directory, `.${fileName}.${randomUUID()}.tmp`);
    const bytes = Buffer.from(`${JSON.stringify(payload, null, 4)}\n`, 'utf8');
    try {
        const handle = await open(temporary, 'wx');
        try {
            await handle.writeFile(bytes);
            await handle.sync();
        } finally {
            await handle.close();
        }
        await rename(temporary, target);
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
    return bytes;
}

export const NODE_ACCEPTANCE_MATRIX_FILE_NAME = 'node-acceptance-matrix.json';
// Bounded per-stream tail kept for nonzero command diagnostics (the full output is mirrored live).
const COMMAND_OUTPUT_TAIL_BYTES = 256 * 1024;

class NodeAcceptanceMatrixError extends Error {
    constructor(reason, message, cause) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = 'NodeAcceptanceMatrixError';
        this.reason = reason;
    }
}

function fail(reason, message, cause) {
    throw new NodeAcceptanceMatrixError(
        reason,
        `node acceptance matrix rejected (${reason}): ${message}`,
        cause,
    );
}

function errorMessageOf(error) {
    return error instanceof Error ? error.message : String(error);
}

const TERMINAL_SUCCESS = 'success';
const NON_SUCCESS_TERMINALS = new Set(['failure', 'cancelled', 'skipped', 'NOT RUN']);

function normalizeCommandTerminal(command, outcome) {
    if (outcome === undefined || outcome === null || typeof outcome !== 'object') {
        return { command, exitCode: null, status: 'NOT RUN' };
    }
    const exitCode = outcome.exitCode;
    let status = outcome.status;
    if (status === undefined || status === null) {
        status = Number.isInteger(exitCode) && exitCode === 0 ? TERMINAL_SUCCESS : 'failure';
    }
    if (status !== TERMINAL_SUCCESS && !NON_SUCCESS_TERMINALS.has(status)) {
        fail(
            'schema-mismatch',
            `command terminal status must be success|failure|cancelled|skipped|NOT RUN (got ${String(status)})`,
        );
    }
    if (status === TERMINAL_SUCCESS && exitCode !== 0) {
        status = 'failure';
    }
    return {
        command,
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        status,
    };
}

function padCommandTerminals(terminals, major) {
    const commands = commandsForMajor(major);
    const byCommand = new Map(terminals.map(t => [t.command, t]));
    return commands.map(command => {
        const existing = byCommand.get(command);
        return existing === undefined
            ? Object.freeze({ command, exitCode: null, status: 'NOT RUN' })
            : Object.freeze({ ...existing });
    });
}

function buildCellRecord({
    major,
    version,
    candidateDigest,
    commandTerminals,
    workspaceCleaned,
    childrenReaped,
    status,
    failReason,
}) {
    const terminals = Object.freeze(padCommandTerminals(commandTerminals, major));
    return Object.freeze({
        major,
        version: version ?? null,
        candidateDigest,
        artifactKey: `node-${major}:${candidateDigest}`,
        commands: Object.freeze([...commandsForMajor(major)]),
        commandTerminals: terminals,
        workspaceCleaned: workspaceCleaned === true,
        childrenReaped: childrenReaped === true,
        status,
        failReason: failReason ?? null,
    });
}

/**
 * Materialize the candidate tree into destination as a detached linked worktree of the repository.
 * Verifies package.json is present (tracked root marker of this repository).
 */
export async function materializeCandidateTree({
    repositoryRoot,
    candidateDigest,
    destination,
    gitArchive = defaultGitArchive,
}) {
    if (typeof candidateDigest !== 'string' || !/^[0-9a-f]{40}$/u.test(candidateDigest)) {
        fail('schema-mismatch', 'candidateDigest must be a 40-hex Git tree object id');
    }
    await gitArchive(repositoryRoot, candidateDigest, destination);
    try {
        await access(join(destination, 'package.json'));
    } catch {
        fail(
            'materialize-mismatch',
            `materialized workspace is missing package.json; candidate tree ${candidateDigest} was not populated`,
        );
    }
    return { destination, candidateDigest, verifiedMarker: 'package.json' };
}

async function defaultGitArchive(repositoryRoot, candidateDigest, destination) {
    // Materialize the candidate tree as a detached linked worktree of the repository rather than a bare
    // `git archive` extraction, so that the workspace is a git repository too and the content record
    // (`worktree-content.mjs`, used by the coverage run inside the cell) can be taken there. A parentless
    // commit carrying exactly `candidateDigest` keeps `HEAD^{tree}` equal to the cell's candidateDigest.
    const commit = await new Promise((resolve, reject) => {
        execFile(
            'git',
            ['-C', repositoryRoot, 'commit-tree', candidateDigest, '-m', 'node acceptance matrix cell workspace'],
            { env: { ...process.env, GIT_AUTHOR_NAME: 'node-matrix', GIT_AUTHOR_EMAIL: 'node-matrix@localhost', GIT_COMMITTER_NAME: 'node-matrix', GIT_COMMITTER_EMAIL: 'node-matrix@localhost' } },
        ).then(({ stdout }) => resolve(stdout.trim()), reject);
    });
    if (!/^[0-9a-f]{40}$/u.test(commit)) {
        throw new Error(`git commit-tree did not return a commit id for ${candidateDigest}`);
    }
    await execFile('git', ['-C', repositoryRoot, 'worktree', 'add', '--detach', destination, commit]);
    const { stdout: materializedTree } = await execFile('git', ['-C', destination, 'rev-parse', 'HEAD^{tree}']);
    if (materializedTree.trim() !== candidateDigest) {
        throw new Error(`materialized worktree tree ${materializedTree.trim()} is not ${candidateDigest}`);
    }
}

/**
 * @param {{
 *   candidateDigest: string,
 *   candidate?: { tree: string, source: 'worktree' | 'argument', headTree: string | null, uncommittedChanges: boolean | null },
 *   nodeVersionForMajor: (major: 24 | 26) => string | Promise<string>,
 *   createWorkspace: (major: 24 | 26) => Promise<string> | string,
 *   runCommand: (major: 24 | 26, command: string, workspaceRoot: string) =>
 *     Promise<{ exitCode: number, status?: string }> | { exitCode: number, status?: string },
 *   cleanupWorkspace: (major: 24 | 26, workspaceRoot: string | undefined) => Promise<void> | void,
 *   reapChildren?: (major: 24 | 26) => Promise<void> | void,
 *   writeArtifact?: (payload: object) => Promise<unknown> | unknown,
 * }} input
 */
export async function runNodeAcceptanceMatrix({
    candidateDigest,
    candidate,
    nodeVersionForMajor,
    createWorkspace,
    runCommand,
    cleanupWorkspace,
    reapChildren,
    writeArtifact,
}) {
    if (typeof candidateDigest !== 'string' || !/^[0-9a-f]{40}$/u.test(candidateDigest)) {
        fail('schema-mismatch', 'candidateDigest must be a 40-hex Git tree object id');
    }
    if (typeof nodeVersionForMajor !== 'function') {
        fail('schema-mismatch', 'nodeVersionForMajor must be a function');
    }
    if (typeof createWorkspace !== 'function') {
        fail('schema-mismatch', 'createWorkspace must be a function');
    }
    if (typeof runCommand !== 'function') {
        fail('schema-mismatch', 'runCommand must be a function');
    }
    if (typeof cleanupWorkspace !== 'function') {
        fail('schema-mismatch', 'cleanupWorkspace must be a function');
    }
    if (reapChildren !== undefined && typeof reapChildren !== 'function') {
        fail('schema-mismatch', 'reapChildren, if provided, must be a function');
    }

    const cells = {};
    const cellFailures = [];

    for (const major of NODE_MATRIX_MAJORS) {
        let version = null;
        let workspaceRoot;
        const commandTerminals = [];
        let cellFailed = false;
        let cellFailReason;
        let childrenReaped = reapChildren === undefined;
        let workspaceCleaned = false;

        try {
            version = await nodeVersionForMajor(major);
        } catch (error) {
            cellFailed = true;
            cellFailReason = 'major-mismatch';
            cellFailures.push({
                major,
                reason: 'major-mismatch',
                message: `failed to resolve Node ${major} version: ${errorMessageOf(error)}`,
                cause: error,
            });
        }
        if (
            !cellFailed &&
            (typeof version !== 'string' || !new RegExp(`^${major}(?:\\.|$)`, 'u').test(version))
        ) {
            cellFailed = true;
            cellFailReason = 'major-mismatch';
            cellFailures.push({
                major,
                reason: 'major-mismatch',
                message: `Node version "${String(version)}" does not identify major ${major}`,
            });
        }

        if (!cellFailed) {
            try {
                workspaceRoot = await createWorkspace(major);
            } catch (error) {
                cellFailed = true;
                cellFailReason = 'workspace-create-failed';
                cellFailures.push({
                    major,
                    reason: 'workspace-create-failed',
                    message: `createWorkspace threw: ${errorMessageOf(error)}`,
                    cause: error,
                });
            }
        }

        // Always fill this major's fixed command terminals for this cell.
        for (const command of commandsForMajor(major)) {
            if (cellFailed || workspaceRoot === undefined) {
                commandTerminals.push({ command, exitCode: null, status: 'NOT RUN' });
                continue;
            }
            try {
                const outcome = await runCommand(major, command, workspaceRoot);
                const terminal = normalizeCommandTerminal(command, outcome);
                commandTerminals.push(terminal);
                if (terminal.status !== TERMINAL_SUCCESS) {
                    cellFailed = true;
                    cellFailReason = 'command-non-success';
                }
            } catch (error) {
                commandTerminals.push({
                    command,
                    exitCode: null,
                    status: 'failure',
                    error: errorMessageOf(error),
                });
                cellFailed = true;
                cellFailReason = 'command-threw';
            }
        }

        if (reapChildren !== undefined) {
            try {
                await reapChildren(major);
                childrenReaped = true;
            } catch (error) {
                childrenReaped = false;
                cellFailures.push({
                    major,
                    reason: 'child-reap-failed',
                    message: `reapChildren threw: ${errorMessageOf(error)}`,
                    cause: error,
                    runReason: cellFailReason,
                });
                cellFailed = true;
                cellFailReason = cellFailReason ?? 'child-reap-failed';
            }
        }

        try {
            await cleanupWorkspace(major, workspaceRoot);
            workspaceCleaned = true;
        } catch (error) {
            workspaceCleaned = false;
            cellFailures.push({
                major,
                reason: 'workspace-cleanup-failed',
                message: `cleanupWorkspace threw: ${errorMessageOf(error)}`,
                cause: error,
                runReason: cellFailReason,
            });
            cellFailed = true;
            cellFailReason = cellFailReason ?? 'workspace-cleanup-failed';
        }

        if (cellFailed && cellFailReason === 'command-non-success') {
            cellFailures.push({
                major,
                reason: 'command-non-success',
                message: `node-${major} cell did not succeed all fixed commands`,
            });
        }

        cells[major] = buildCellRecord({
            major,
            version,
            candidateDigest,
            commandTerminals,
            workspaceCleaned,
            childrenReaped,
            status: cellFailed ? 'failure' : 'success',
            failReason: cellFailed ? cellFailReason : null,
        });
    }

    const bothCellsTerminal = NODE_MATRIX_MAJORS.every(major => cells[major] !== undefined);
    const bothCellsSuccess =
        bothCellsTerminal && NODE_MATRIX_MAJORS.every(major => cells[major].status === 'success');
    const payload = Object.freeze({
        candidateDigest,
        ...(candidate === undefined ? {} : { candidate: Object.freeze({ ...candidate }) }),
        cells: Object.freeze({ ...cells }),
        bothCellsTerminal,
        bothCellsSuccess,
    });

    // Always publish terminal artifact (success and failure paths) before deciding the process outcome.
    if (typeof writeArtifact === 'function') {
        await writeArtifact(payload);
    }

    if (!bothCellsSuccess || cellFailures.length > 0) {
        const onlyMajorMismatch =
            cellFailures.length > 0 && cellFailures.every(f => f.reason === 'major-mismatch');
        const reason = onlyMajorMismatch ? 'major-mismatch' : 'cells-failed';
        const summary =
            cellFailures.length > 0
                ? cellFailures
                      .map(failure => `node-${failure.major} (${failure.reason}): ${failure.message}`)
                      .join('; ')
                : NODE_MATRIX_MAJORS.filter(m => cells[m]?.status !== 'success')
                      .map(m => `node-${m} (${cells[m]?.failReason ?? 'failure'})`)
                      .join('; ');
        const error = new NodeAcceptanceMatrixError(
            reason,
            `node matrix non-success after both cells terminal: ${summary}`,
            cellFailures[0]?.cause,
        );
        error.cellFailures = Object.freeze(
            cellFailures.map(failure =>
                Object.freeze({
                    major: failure.major,
                    reason: failure.reason,
                    message: failure.message,
                    runReason: failure.runReason,
                }),
            ),
        );
        error.cells = payload.cells;
        error.bothCellsTerminal = bothCellsTerminal;
        error.payload = payload;
        throw error;
    }

    return payload;
}

async function defaultGit(args, cwd) {
    const { stdout } = await execFile('git', args, { cwd });
    return stdout.trim();
}

async function defaultNodeVersion(major) {
    const { stdout } = await execFile('mise', ['exec', `node@${major}`, '--', 'node', '-v'], {
        env: process.env,
    });
    return stdout.trim().replace(/^v/u, '');
}

function childStillOpen(child) {
    return child.exitCode === null && child.signalCode === null;
}

/**
 * Default adapters: each major gets a fresh directory with the candidate tree materialized.
 */
export function createDefaultNodeMatrixAdapters({
    repositoryRoot = process.cwd(),
    candidateDigest,
    git = defaultGit,
    materialize = materializeCandidateTree,
} = {}) {
    if (typeof candidateDigest !== 'string' || !/^[0-9a-f]{40}$/u.test(candidateDigest)) {
        fail('schema-mismatch', 'createDefaultNodeMatrixAdapters requires candidateDigest 40-hex tree id');
    }
    // Shared state object so tests can inject synthetic children into the same Map the adapter reaps.
    const state = {
        workspaces: new Map(),
        children: new Map(),
    };

    return {
        nodeVersionForMajor: major => defaultNodeVersion(major),
        createWorkspace: async major => {
            // Register ownership immediately after mkdtemp so materialize/marker reject still
            // leaves a reclaimable workspace for cleanupWorkspace(major).
            const root = await mkdtemp(join(tmpdir(), `epgstation-node-${major}-`));
            state.workspaces.set(major, root);
            try {
                await materialize({
                    repositoryRoot,
                    candidateDigest,
                    destination: root,
                });
            } catch (error) {
                // Ownership remains in state.workspaces; orchestrator cleanup reclaims the root.
                throw error;
            }
            return root;
        },
        runCommand: async (major, command, workspaceRoot) => {
            const child = spawn('mise', ['exec', `node@${major}`, '--', 'bash', '-lc', command], {
                cwd: workspaceRoot,
                env: nodeMatrixCommandEnv(major, command, process.env),
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            // Drain both pipes continuously. A piped child whose output is never read blocks on
            // write once the 64 KiB pipe buffer fills (`npm run test:server` alone exceeds it), which
            // hangs the whole matrix with the vitest parent in sock_alloc_send_pskb.
            // Output is mirrored to this runner's own stdio (so a logged unit keeps it) and the tail
            // of each stream is retained, bounded, for the nonzero diagnostics below.
            const tails = { stdout: [], stderr: [] };
            const retainTail = (name, chunk) => {
                const buffered = tails[name];
                buffered.push(chunk);
                let total = buffered.reduce((sum, part) => sum + part.length, 0);
                while (total > COMMAND_OUTPUT_TAIL_BYTES && buffered.length > 1) {
                    total -= buffered.shift().length;
                }
            };
            child.stdout.on('data', chunk => {
                process.stdout.write(chunk);
                retainTail('stdout', chunk);
            });
            child.stderr.on('data', chunk => {
                process.stderr.write(chunk);
                retainTail('stderr', chunk);
            });
            const list = state.children.get(major) ?? [];
            list.push(child);
            state.children.set(major, list);
            return await new Promise(resolve => {
                child.on('error', error => {
                    resolve({ exitCode: 1, status: 'failure', error: errorMessageOf(error) });
                });
                child.on('close', (code, signal) => {
                    if (signal) {
                        resolve({ exitCode: code ?? 1, status: 'cancelled' });
                        return;
                    }
                    if (code !== 0) {
                        process.stderr.write(
                            `node-${major} command failed (exit ${String(code)}): ${command}\n--- stdout tail ---\n${Buffer.concat(tails.stdout).toString('utf8')}\n--- stderr tail ---\n${Buffer.concat(tails.stderr).toString('utf8')}\n`,
                        );
                    }
                    resolve({
                        exitCode: code ?? 1,
                        status: code === 0 ? 'success' : 'failure',
                    });
                });
            });
        },
        reapChildren: async major => {
            const list = state.children.get(major) ?? [];
            await Promise.all(
                list.map(
                    child =>
                        new Promise(resolve => {
                            if (!childStillOpen(child)) {
                                resolve();
                                return;
                            }
                            const timer = setTimeout(() => {
                                try {
                                    child.kill('SIGKILL');
                                } catch {
                                    // ignore
                                }
                            }, 1000);
                            child.once('close', () => {
                                clearTimeout(timer);
                                resolve();
                            });
                            try {
                                child.kill('SIGTERM');
                            } catch {
                                clearTimeout(timer);
                                resolve();
                            }
                        }),
                ),
            );
            state.children.set(major, []);
        },
        cleanupWorkspace: async major => {
            const root = state.workspaces.get(major);
            if (root !== undefined) {
                // The workspace is a linked worktree carrying `npm ci` output: detach its registration
                // (force: untracked node_modules) and fall back to removing the directory.
                try {
                    await execFile('git', ['-C', repositoryRoot, 'worktree', 'remove', '--force', root]);
                } catch {
                    await rm(root, { recursive: true, force: true });
                }
                try {
                    await execFile('git', ['-C', repositoryRoot, 'worktree', 'prune']);
                } catch {
                    // registration cleanup is best effort; the directory is gone either way
                }
                state.workspaces.delete(major);
            }
        },
        repositoryRoot,
        git,
        /** @internal test seam — same Map instance used by reapChildren */
        _state: state,
    };
}

/**
 * Decides what the matrix verifies: `--candidate <tree>` when given (source `argument`), otherwise the
 * worktree's content as it is now (source `worktree`, uncommitted changes and non-ignored untracked
 * files included). Neither HEAD nor uncommitted changes decide the outcome; the record states which
 * content was verified and whether it differs from HEAD.
 */
async function decideCandidate({ candidateDigest, repositoryRoot, snapshotWorktree }) {
    const worktreeContent = await snapshotWorktree(repositoryRoot);
    const tree = candidateDigest ?? worktreeContent?.contentTree ?? null;
    if (tree === null) {
        fail(
            'materialize-failed',
            'the content to verify could not be determined: this is not a git repository or its tree could not be computed',
        );
    }
    const headTree = worktreeContent?.headTree ?? null;
    return {
        tree,
        source: candidateDigest === undefined ? 'worktree' : 'argument',
        headTree,
        uncommittedChanges: headTree === null ? null : tree !== headTree,
    };
}

export async function runNodeAcceptanceMatrixCli({
    candidateDigest,
    repositoryRoot = process.cwd(),
    git = defaultGit,
    snapshotWorktree = snapshotWorktreeContent,
    createAdapters = createDefaultNodeMatrixAdapters,
    adapters,
    writeEvidenceArtifact = writeNodeAcceptanceArtifact,
} = {}) {
    const candidate = await decideCandidate({ candidateDigest, repositoryRoot, snapshotWorktree });
    const resolvedAdapters =
        adapters ??
        createAdapters({
            repositoryRoot,
            candidateDigest: candidate.tree,
            git,
        });

    const publish = async payload =>
        writeEvidenceArtifact(repositoryRoot, NODE_ACCEPTANCE_MATRIX_FILE_NAME, payload);

    try {
        return await runNodeAcceptanceMatrix({
            candidateDigest: candidate.tree,
            candidate,
            nodeVersionForMajor: resolvedAdapters.nodeVersionForMajor,
            createWorkspace: resolvedAdapters.createWorkspace,
            runCommand: resolvedAdapters.runCommand,
            cleanupWorkspace: resolvedAdapters.cleanupWorkspace,
            reapChildren: resolvedAdapters.reapChildren,
            writeArtifact: publish,
        });
    } catch (error) {
        // Failure path already published via writeArtifact inside runNodeAcceptanceMatrix when provided.
        // If throw occurred before publish (e.g. schema), rethrow as-is.
        if (error instanceof NodeAcceptanceMatrixError && error.payload !== undefined) {
            // ensure published even if writeArtifact was skipped due to early throw — already done
        }
        throw error;
    }
}

export function parseNodeAcceptanceMatrixArguments(argv) {
    const allowed = new Set(['--candidate']);
    const values = new Map();
    for (let index = 2; index < argv.length; index += 2) {
        const name = argv[index];
        const value = argv[index + 1];
        if (!allowed.has(name) || values.has(name) || value === undefined || value.startsWith('--')) {
            throw new Error(
                `node acceptance matrix CLI rejected: invalid or duplicate option: ${name ?? '(missing)'}`,
            );
        }
        values.set(name, value);
    }
    if (argv.length % 2 !== 0) {
        throw new Error('node acceptance matrix CLI rejected: every option requires one value');
    }
    const candidate = values.get('--candidate');
    if (candidate === '') {
        throw new Error('node acceptance matrix CLI rejected: --candidate requires a tree id');
    }
    // Without `--candidate` the worktree's current content is verified (see `decideCandidate`).
    return { candidateDigest: candidate };
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
    try {
        const { candidateDigest } = parseNodeAcceptanceMatrixArguments(process.argv);
        await runNodeAcceptanceMatrixCli({ candidateDigest });
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}

export { NodeAcceptanceMatrixError };
