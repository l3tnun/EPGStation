import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const SCRATCH_SEGMENTS = ['test', 'server', '.artifacts', 'worktree-content'];

/**
 * @typedef {object} WorktreeContentRecord
 * @property {string | null} contentTree tree id of the worktree's content: the tracked files as they are now plus
 *   the untracked files git does not ignore. `null` when it cannot be computed.
 * @property {string | null} headTree `HEAD^{tree}`, `null` when it cannot be resolved.
 * @property {boolean | null} uncommittedChanges `contentTree !== headTree`, `null` when either is unknown.
 */

/**
 * Receives one line describing why a step of the computation failed. The default writes it to stderr so that a
 * `null` field never loses its cause.
 *
 * @typedef {(message: string) => void} DiagnosticSink
 */

/** @type {DiagnosticSink} */
const writeDiagnosticToStderr = (message) => {
    process.stderr.write(`worktree-content: ${message}\n`);
};

/** The first lines of a failed command's stderr, or the error's own message when git printed nothing. */
function failureDetail(error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    if (stderr.length > 0) {
        return stderr.split('\n').slice(0, 3).join(' / ');
    }
    return typeof error?.code === 'number' ? `exit code ${error.code}` : String(error?.message ?? error);
}

/**
 * Runs `git` in `repositoryRoot` and returns trimmed stdout, or `null` when git is unavailable or the command fails.
 * A failure is reported to `report` with the command and the start of git's stderr.
 */
async function runGit(repositoryRoot, arguments_, environment, report) {
    try {
        const { stdout } = await execFile('git', arguments_, {
            cwd: repositoryRoot,
            env: environment,
            maxBuffer: 64 * 1024 * 1024,
        });
        return stdout.trim();
    } catch (error) {
        report(`git ${arguments_.join(' ')} failed: ${failureDetail(error)}`);
        return null;
    }
}

/**
 * Computes the tree id of the worktree's current content without touching the user's index, working files or refs.
 * The tree is built in a throwaway index (`GIT_INDEX_FILE`): `read-tree HEAD`, `add -A`, `write-tree`. Only git
 * objects are added to the object database. The scratch index lives under
 * `test/server/.artifacts/worktree-content/` and is removed afterwards.
 *
 * Git is never searched for above `repositoryRoot`, so a directory that is not itself a repository reports `null`
 * fields even when it sits inside another repository. Callers decide what a `null` field means. Whenever a field
 * is `null`, the failed command and the start of git's stderr go to `report`.
 *
 * @param {string} repositoryRoot
 * @param {{ report?: DiagnosticSink }} [options]
 * @returns {Promise<WorktreeContentRecord>}
 */
export async function snapshotWorktreeContent(repositoryRoot, { report = writeDiagnosticToStderr } = {}) {
    const root = resolve(repositoryRoot);
    const baseEnvironment = { ...process.env, GIT_CEILING_DIRECTORIES: dirname(root) };
    delete baseEnvironment.GIT_DIR;
    delete baseEnvironment.GIT_WORK_TREE;
    delete baseEnvironment.GIT_INDEX_FILE;

    const headTree = await runGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{tree}'], baseEnvironment, report);
    if (headTree === null || headTree.length === 0) {
        // Not a repository, or no commit to build the throwaway index from.
        return { contentTree: null, headTree: null, uncommittedChanges: null };
    }
    const contentTree = await contentTreeOf(root, baseEnvironment, report);
    return {
        contentTree,
        headTree,
        uncommittedChanges: contentTree === null ? null : contentTree !== headTree,
    };
}

async function contentTreeOf(root, baseEnvironment, report) {
    const scratchRoot = join(root, ...SCRATCH_SEGMENTS);
    let scratch;
    try {
        await mkdir(scratchRoot, { recursive: true });
        scratch = await mkdtemp(join(scratchRoot, 'index-'));
    } catch (error) {
        report(`the scratch directory ${scratchRoot} could not be created: ${failureDetail(error)}`);
        return null;
    }
    try {
        const environment = { ...baseEnvironment, GIT_INDEX_FILE: join(scratch, 'index') };
        if ((await runGit(root, ['read-tree', 'HEAD'], environment, report)) === null) {
            return null;
        }
        if ((await runGit(root, ['add', '-A'], environment, report)) === null) {
            return null;
        }
        // The scratch index itself sits in the worktree: it is never part of the content, whether or not the
        // repository ignores `test/server/.artifacts/`.
        const scratchPath = SCRATCH_SEGMENTS.join('/');
        if (
            (await runGit(
                root,
                ['rm', '--cached', '-r', '-f', '-q', '--ignore-unmatch', '--', scratchPath],
                environment,
                report,
            )) === null
        ) {
            return null;
        }
        const tree = await runGit(root, ['write-tree'], environment, report);
        return tree === null || tree.length === 0 ? null : tree;
    } finally {
        await rm(scratch, { recursive: true, force: true });
    }
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`;

if (isDirectRun) {
    const record = await snapshotWorktreeContent(process.cwd());
    if (record.contentTree === null) {
        process.stderr.write('worktree-content: the content tree of the current directory could not be computed\n');
        process.exitCode = 1;
    } else {
        process.stdout.write(`${record.contentTree}\n`);
    }
}
