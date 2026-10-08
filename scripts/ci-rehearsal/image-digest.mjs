#!/usr/bin/env node
/**
 * Identity of the rehearsal runner image, derived from everything the image bakes in that decides
 * which toolchain and which dependency tree the rehearsal runs against.
 *
 * The image exists so a rehearsal does not fetch mise, Node, npm packages or Playwright browsers on
 * every run: fetching them made the gate fail whenever a remote was slow or returned 5xx, which is
 * not a finding about this repository. Caching them, though, introduces the failure the fetch never
 * had -- running against a toolchain or a dependency tree that is no longer the declared one. This
 * digest is what closes that: the image records it, the runner recomputes it, and a mismatch stops
 * the run instead of testing the wrong thing.
 *
 * `server.yml` contributes whole rather than just its install step, which is what pins the mise
 * version and its checksum. Reading one step out of it needs a YAML parser, and this has to answer
 * before the image exists and without assuming an installed dependency tree. Hashing the file costs
 * a rebuild on workflow edits that change nothing the image holds; those are rare, and a rebuild
 * too many is the harmless direction to err in.
 *
 * Both mise files contribute: the client declares its own Node and npm, and a rehearsal that ran
 * the client checks under the root's versions would not be running what the client asks for.
 *
 * The four package manifests carry the dependency trees: the lockfiles pin resolved versions and
 * their integrity, the package.json files the ranges those were resolved from. A lockfile that no
 * longer matches its package.json is exactly the drift this must catch, and `npm ci` during the
 * image build is what reports it.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const IMAGE_INPUTS = Object.freeze([
    '.github/workflows/server.yml',
    'mise.toml',
    'client/mise.toml',
    'package.json',
    'package-lock.json',
    'client/package.json',
    'client/package-lock.json',
]);

/**
 * Names are hashed alongside their contents so identical bytes under two different paths -- the two
 * package.json files can converge -- cannot collide into the same digest.
 *
 * The inputs come from the working directory by default. With `tree` (a git tree id) they are read
 * from that tree instead, so a run that verifies a content tree fixed earlier compares the image with
 * what that tree declares rather than with whatever the files hold by the time this runs.
 *
 * @param {{ tree?: string, root?: string }} [options]
 */
export function rehearsalImageDigest({ tree, root = repositoryRoot } = {}) {
    const read = (input) =>
        tree === undefined
            ? readFileSync(join(root, input))
            : execFileSync('git', ['-C', root, 'show', `${tree}:${input}`], { maxBuffer: 256 * 1024 * 1024 });
    const digest = createHash('sha256');
    for (const input of IMAGE_INPUTS) {
        digest.update(input);
        digest.update('\0');
        digest.update(createHash('sha256').update(read(input)).digest());
    }
    return digest.digest('hex');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const treeFlag = process.argv.indexOf('--tree');
    if (treeFlag !== -1 && !/^[0-9a-f]{40}$/u.test(process.argv[treeFlag + 1] ?? '')) {
        process.stderr.write('image-digest: --tree needs a 40-hex tree id\n');
        process.exit(2);
    }
    const full = rehearsalImageDigest(treeFlag === -1 ? {} : { tree: process.argv[treeFlag + 1] });
    process.stdout.write(process.argv.includes('--short') ? `${full.slice(0, 12)}\n` : `${full}\n`);
}
