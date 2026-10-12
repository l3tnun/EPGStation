import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

import {
    classifyServerTestPath,
    exclusionPatterns,
    integrationPatterns,
    implementationPatterns,
    specificationPatterns,
} from './scripts/server-test/test-selection.mjs';
import { platformBoundaryMatrix } from './scripts/server-test/platform-boundary/matrix.mjs';
import {
    discoverPlatformSpecificFiles,
    selectPlatformBoundaryFiles,
} from './scripts/server-test/platform-boundary/selector.mjs';

const serverTestRoot = fileURLToPath(new URL('test/server/', import.meta.url));

// Platform boundary selection (ODI-044): before Vitest collects any test, decide which of the
// tracked, platform-specific files (see scripts/server-test/platform-boundary/matrix.mjs) belong
// to the current process.platform and exclude every other platform's files from collection
// entirely. Fails closed (throws) if the matrix itself is invalid. This does not change normal
// feature/task test selection or Node version policy: it only ever removes,
// from exactly the one project whose own naming-convention include pattern would otherwise have
// matched it (via the same `classifyServerTestPath` the rest of this config already trusts), a
// file that is not selected for the current platform class. A file is never added to a project's
// `exclude` it would never have been `include`d by in the first place, so the approved base
// `exclusionPatterns` contract stays untouched for every project the current platform's matrix
// entries do not affect.
const platformBoundarySelection = selectPlatformBoundaryFiles(process.platform, platformBoundaryMatrix, {
    discoveredFiles: discoverPlatformSpecificFiles(serverTestRoot),
});
const platformBoundaryExcludeForProject = (projectName: 'spec' | 'imp' | 'integration'): string[] =>
    platformBoundarySelection.excluded
        .filter(file => classifyServerTestPath(file).includes(projectName))
        .map(file => file.replace(/^test\/server\//u, ''));

const common = {
    passWithNoTests: false,
    exclude: ['.artifacts/**'],
    sequence: {
        concurrent: false,
    },
    // The default fork pool terminates each worker via `process.kill()` instead of letting it exit normally,
    // so V8 never flushes that worker's own `NODE_V8_COVERAGE` raw dump. This setup file forces
    // that flush (guarded on `NODE_V8_COVERAGE` being set) while the worker is still alive.
    setupFiles: [fileURLToPath(new URL('test/server/harness/coverage-raw-flush.ts', import.meta.url))],
};

export default defineConfig({
    root: 'test/server',
    test: {
        ...common,
        projects: [
            {
                root: serverTestRoot,
                test: {
                    ...common,
                    name: 'spec',
                    include: specificationPatterns,
                    exclude: [...exclusionPatterns.spec, ...platformBoundaryExcludeForProject('spec')],
                },
            },
            {
                root: serverTestRoot,
                test: {
                    ...common,
                    name: 'imp',
                    include: implementationPatterns,
                    exclude: [...exclusionPatterns.imp, ...platformBoundaryExcludeForProject('imp')],
                },
            },
            {
                root: serverTestRoot,
                test: {
                    ...common,
                    name: 'integration',
                    include: integrationPatterns,
                    exclude: [...exclusionPatterns.integration, ...platformBoundaryExcludeForProject('integration')],
                },
            },
        ],
        coverage: {
            provider: 'v8',
            enabled: false,
            all: true,
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.d.ts'],
            reportsDirectory: 'test/server/.artifacts/coverage',
            // Under EPGSTATION_COVERAGE_CONVERTER (run-tests.mjs's own direct `coverage` mode -- see
            // run-tests.mjs's runAgainstCompiledSnapshot), a downstream converter atomically
            // overwrites coverage-final.json with its own canonical output right after this provider
            // runs. Narrowed to json-only so the provider's other reports (coverage-summary.json,
            // lcov.info, lcov-report/) -- which the converter never touches or binds -- do not sit
            // un-bound in the same canonical directory next to the converter's sidecar-bound
            // coverage-final.json (a downstream reader of coverage-summary.json would otherwise get
            // numbers that never pass any hash check).
            reporter:
                process.env.EPGSTATION_COVERAGE_CONVERTER === '1' ? ['json'] : ['text', 'json', 'json-summary', 'lcov'],
            // Under EPGSTATION_COVERAGE_CONVERTER, `run-tests.mjs`'s `coverage` mode is never blocked
            // from reaching writeCanonicalCoverageArtifacts by this provider's own measurement -- the
            // converter's basis judges coverage, not this provider's threshold. The inner converter
            // terminal lives in run-tests.mjs's runAgainstCompiledSnapshot
            // (evaluateConverterCoverageTerminal): C0 and C1 under 100% end the command with
            // `BELOW_FULL_COVERAGE_EXIT_CODE`. Ordinary non-coverage runs keep the threshold below.
            ...(process.env.EPGSTATION_COVERAGE_CONVERTER === '1'
                ? {}
                : { thresholds: { statements: 100, branches: 100 } }),
        },
    },
});
