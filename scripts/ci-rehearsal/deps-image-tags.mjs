#!/usr/bin/env node
/**
 * The dependency image tags the gate would use for the current manifests, one per line.
 *
 * A dependency image is built in two layers (see scripts/server-test/dependency-images.mjs): the OS
 * packages onto a pinned base, and `npm ci` from the manifests onto that. Each layer's tag is
 * derived from its own inputs, so the same inputs produce the same tag and the image is reused
 * instead of fetching the same packages from the same registries again. This lists the tags of both
 * layers.
 *
 * The rehearsal setup prunes tags this does not list. That has to agree exactly with what the gate
 * and the preparation step compute -- a tag this failed to name would be removed and then rebuilt on
 * the next run, quietly undoing the reuse -- so all of them derive it from the one module rather than
 * each carrying its own copy of the rule.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dependencyImageTags as tagsFor } from '../server-test/dependency-images.mjs';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

export function dependencyImageTags() {
    return tagsFor(repositoryRoot);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.stdout.write(`${dependencyImageTags().join('\n')}\n`);
}
