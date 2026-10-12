// Platform boundary selector.
//
// Selects, before Vitest collects tests, exactly which platform-specific test files run for the
// current process.platform. Platform-specific test bodies never call `.skip`/`.skipIf`/`.runIf`
// or early-return on a platform check; instead this module removes the wrong-platform file from
// collection entirely; such an in-body pattern must not be written in the first place.
//
// This module owns only the platform-boundary matrix/selection mechanism. It does not read or
// change `scripts/server-test/test-selection.mjs`, and it must not alter normal feature/task test
// selection or Node version policy.

import { existsSync, readdirSync } from 'node:fs';

export const platformClasses = Object.freeze(['posix', 'win32']);

export class PlatformBoundaryMatrixError extends Error {
    constructor(violations) {
        super(
            `platform boundary matrix is invalid (fail closed): ${violations
                .map(violation => `${violation.code}${violation.file === undefined ? '' : `:${violation.file}`}`)
                .join(', ')}`,
        );
        this.name = 'PlatformBoundaryMatrixError';
        this.violations = violations;
    }
}

/**
 * Resolves a `process.platform` value to the platform class used by the matrix. `linux` and
 * `darwin` both resolve to `posix`; only `win32` resolves to `win32`. Any other value (including
 * an injected unknown value used by tests) fails closed by throwing, matching the required
 * `unknown` -> fail-closed row of the selector's synthetic verification matrix.
 */
export const resolvePlatformClass = platform => {
    if (platform === 'linux' || platform === 'darwin') return 'posix';
    if (platform === 'win32') return 'win32';
    throw new Error(`platform boundary selector: unknown platform "${String(platform)}" (fail closed)`);
};

const isPlatformSpecificFileName = name => /\.(?:posix|win32)\./u.test(name) && name.endsWith('.test.ts');

/**
 * Walks a `test/server` directory (an absolute filesystem path) and returns the repository-root
 * relative paths (`test/server/...`, posix-separated) of every file that follows the
 * `*.posix.*.test.ts` / `*.win32.*.test.ts` platform-specific naming convention. `.artifacts` and
 * `node_modules` are never descended into.
 */
export const discoverPlatformSpecificFiles = (testServerRoot, deps = {}) => {
    const readDirectory = deps.readdirSync ?? readdirSync;
    const results = [];

    const walk = (absoluteDirectory, relativeDirectory) => {
        for (const entry of readDirectory(absoluteDirectory, { withFileTypes: true })) {
            if (entry.name === '.artifacts' || entry.name === 'node_modules') continue;
            const relativePath = relativeDirectory === '' ? entry.name : `${relativeDirectory}/${entry.name}`;
            if (entry.isDirectory()) {
                walk(`${absoluteDirectory}/${entry.name}`, relativePath);
            } else if (entry.isFile() && isPlatformSpecificFileName(entry.name)) {
                results.push(`test/server/${relativePath}`);
            }
        }
    };

    walk(testServerRoot, '');
    return results.sort();
};

/**
 * Validates the tracked platform boundary matrix. Throws `PlatformBoundaryMatrixError` (fail
 * closed) unless every one of the following holds:
 *
 *  1. every discovered `*.posix.*.test.ts` / `*.win32.*.test.ts` file (via `deps.discoveredFiles`)
 *     is registered in the matrix,
 *  2. every registered file exists on disk (via `deps.fileExists`),
 *  3. no file is registered more than once,
 *  4. every entry declares a known `platformClass` (`posix` or `win32`),
 *  5/6. every entry's declared `platformClass` matches its filename's `.posix.`/`.win32.` naming
 *     token, so a POSIX file can never be mis-registered as `win32` (and be wrongly selected for
 *     win32) and a win32 file can never be mis-registered as `posix` (and be wrongly selected for
 *     posix).
 *
 * This is a positive execution inventory, not a path allowlist: registered files remain subject to
 * the same rule as every other test file (no platform-specific case inside a test body).
 */
export const validatePlatformBoundaryMatrix = (matrix, deps = {}) => {
    const fileExists = deps.fileExists ?? existsSync;
    const discoveredFiles = deps.discoveredFiles ?? [];
    const violations = [];
    const seen = new Set();

    for (const entry of matrix) {
        if (seen.has(entry.file)) {
            violations.push({ code: 'DUPLICATE_FILE', file: entry.file });
        }
        seen.add(entry.file);

        if (!platformClasses.includes(entry.platformClass)) {
            violations.push({ code: 'UNKNOWN_PLATFORM_CLASS', file: entry.file, platformClass: entry.platformClass });
        } else {
            const name = entry.file.split('/').pop() ?? '';
            const namedPosix = name.includes('.posix.');
            const namedWin32 = name.includes('.win32.');
            if (namedPosix && entry.platformClass !== 'posix') {
                violations.push({
                    code: 'NAMING_CLASS_MISMATCH',
                    file: entry.file,
                    platformClass: entry.platformClass,
                });
            }
            if (namedWin32 && entry.platformClass !== 'win32') {
                violations.push({
                    code: 'NAMING_CLASS_MISMATCH',
                    file: entry.file,
                    platformClass: entry.platformClass,
                });
            }
        }

        if (!fileExists(entry.file)) {
            violations.push({ code: 'MISSING_FILE', file: entry.file });
        }
    }

    const registered = new Set(matrix.map(entry => entry.file));
    for (const file of discoveredFiles) {
        if (!registered.has(file)) {
            violations.push({ code: 'UNREGISTERED_PLATFORM_FILE', file });
        }
    }

    if (violations.length > 0) {
        throw new PlatformBoundaryMatrixError(violations);
    }

    return true;
};

/**
 * Selects, for the given `process.platform` value, which registered platform-boundary files
 * should be collected (`included`) and which must be excluded from collection entirely
 * (`excluded`). Validates the matrix first (fail closed on any of the nine matrix conditions), so
 * a broken matrix never silently selects the wrong files.
 */
export const selectPlatformBoundaryFiles = (platform, matrix, deps = {}) => {
    validatePlatformBoundaryMatrix(matrix, deps);
    const platformClass = resolvePlatformClass(platform);
    const included = matrix.filter(entry => entry.platformClass === platformClass).map(entry => entry.file);
    const excluded = matrix.filter(entry => entry.platformClass !== platformClass).map(entry => entry.file);
    return Object.freeze({ platformClass, included: Object.freeze(included), excluded: Object.freeze(excluded) });
};
