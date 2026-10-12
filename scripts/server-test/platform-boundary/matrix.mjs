// Tracked platform boundary matrix.
//
// Every test file that is inherently OS-dependent (and therefore cannot run, meaningfully, on
// every platform) is registered here instead of gating on `process.platform` inside the test body.
// `scripts/server-test/platform-boundary/selector.mjs` selects which of these files are collected
// for the current `process.platform`; every other test/server file is shared and must never
// contain a platform-specific case.
//
// Each entry:
//  - file:                     repository-root relative path (posix-separated) to the exact
//                               registered test file. Must exist and be registered exactly once.
//  - platformClass:            'posix' (linux + darwin) or 'win32' (Windows only).
//  - reason:                   the verified OS boundary this file exercises.
//  - ownerSpec:                the owning `.kiro/specs/server-*` feature.
//  - expectedExecutionCategory: the scripts/server-test/test-selection.mjs project
//                               ('spec' | 'imp' | 'integration') this file's own naming convention
//                               (`.spec.test.ts` / `.integration.test.ts` / plain `.test.ts`)
//                               already resolves to. Recorded here for audit; this matrix does not
//                               alter that classification.

export const platformBoundaryMatrix = Object.freeze([
    Object.freeze({
        file: 'test/server/tuner-access/implementation.posix.test.ts',
        platformClass: 'posix',
        reason:
            'Best-effort characterization of the named-pipe request seam, historically collected on ' +
            'the POSIX CI this repository runs on. Per .kiro/specs/server-tuner-access/design.md, ' +
            'Windows is not an officially supported server host OS, so this mocked seam is kept ' +
            'POSIX-only rather than asserted against unverified win32 path-handling behavior; the real ' +
            'win32 named-pipe connection is separately characterized in ' +
            'test/server/tuner-access/transport.win32.integration.test.ts.',
        ownerSpec: 'server-tuner-access',
        expectedExecutionCategory: 'imp',
    }),
    Object.freeze({
        file: 'test/server/tuner-access/transport.win32.integration.test.ts',
        platformClass: 'win32',
        reason:
            'Connects the tuner transport through an actual Windows named pipe (`\\\\.\\pipe\\...`), ' +
            'which only exists as a real, connectable OS resource on win32.',
        ownerSpec: 'server-tuner-access',
        expectedExecutionCategory: 'integration',
    }),
]);
