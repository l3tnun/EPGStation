export const recordingTestLayers = ['spec', 'imp', 'integration'];

const domainPath = file => `test/server/recording-execution/${file}`;
const test = (file, layer, adapters = []) => ({ adapters, layer, path: domainPath(file) });

/**
 * 共有 server runner 登録表。並び順は承認済み task の domain 順で固定する。
 * runner 自体の glob/classification は scripts/server-test/test-selection.mjs が所有する。
 */
export const recordingDomainSuiteMatrix = [
    { name: 'candidate', tests: [test('candidates.spec.test.ts', 'spec', ['fake-timer'])] },
    {
        name: 'scheduler',
        tests: [
            test('scheduler-equivalence-p1.imp.test.ts', 'imp'),
            test('scheduler.imp.test.ts', 'imp', ['fake-timer', 'stream', 'filesystem']),
        ],
    },
    {
        name: 'mutation',
        tests: [
            test('recording-manage-mutation-boundaries.imp.test.ts', 'imp', ['fake-timer']),
            test('recording-manage-p1.test.ts', 'imp', ['fake-timer']),
            test('mutation-acceptance-facade.integration.test.ts', 'integration'),
            test('apply-schedule-removal.imp.test.ts', 'imp'),
        ],
    },
    {
        name: 'session',
        tests: [
            test('preparation.spec.test.ts', 'spec', ['fake-timer', 'stream', 'filesystem']),
            test('recording-start.spec.test.ts', 'spec', ['fake-timer', 'stream', 'filesystem']),
            test('reservation-changes.spec.test.ts', 'spec', ['fake-timer', 'stream']),
            test('session.imp.test.ts', 'imp', ['fake-timer', 'stream', 'filesystem']),
            test('time-start-boundary.test.ts', 'imp', ['fake-timer', 'stream']),
        ],
    },
    {
        name: 'path-coordinator',
        tests: [
            test('filename-format.imp.test.ts', 'imp', ['filesystem']),
            test('filesystem.integration.test.ts', 'integration', ['fake-timer', 'stream', 'filesystem']),
            test('path.imp.test.ts', 'imp', ['fake-timer', 'filesystem']),
            test('sub-directory-util.imp.test.ts', 'imp'),
        ],
    },
    {
        name: 'finalization',
        tests: [
            test('finalization.imp.test.ts', 'imp', ['stream']),
            test('finalization.spec.test.ts', 'spec', ['stream']),
        ],
    },
    { name: 'retry', tests: [test('retry.spec.test.ts', 'spec', ['fake-timer'])] },
    {
        name: 'tuner-contract',
        tests: [
            test('stream-allocation-boundary.test.ts', 'imp', ['fake-timer', 'stream']),
            test('settuner-delegation.imp.test.ts', 'imp'),
            test('tuner-boundary.spec.test.ts', 'spec', ['fake-timer', 'stream', 'filesystem']),
            test('tuner-stream.integration.test.ts', 'integration', ['fake-timer', 'stream']),
        ],
    },
    {
        name: 'startup-cleanup',
        tests: [
            test('reservation-startup-reevaluation.integration.test.ts', 'integration'),
            test('startup.imp.test.ts', 'imp', ['fake-timer']),
            test('startup.spec.test.ts', 'spec', ['fake-timer']),
            test('flush-pending-startup-failures.imp.test.ts', 'imp'),
        ],
    },
    {
        name: 'process-integration',
        tests: [
            test('binding-refresh.integration.test.ts', 'integration', ['fake-timer', 'stream']),
            test('ipc-event.integration.test.ts', 'integration', ['fake-timer', 'stream', 'filesystem']),
            test('persistence.integration.test.ts', 'integration', ['stream', 'filesystem', 'sqlite', 'mysql']),
            test('doubles-parity.integration.test.ts', 'integration', ['stream', 'filesystem', 'sqlite', 'mysql']),
            test('real-clock-change.integration.test.ts', 'integration', [
                'fake-timer',
                'stream',
                'filesystem',
                'sqlite',
            ]),
            test('real-path-selection.integration.test.ts', 'integration', ['stream', 'filesystem', 'sqlite']),
            test('real-preparation-retry.integration.test.ts', 'integration', ['stream', 'sqlite']),
            test('real-scheduling.integration.test.ts', 'integration', ['stream', 'filesystem', 'sqlite']),
            test('real-stream-failure.integration.test.ts', 'integration', ['stream', 'filesystem', 'sqlite']),
            test('real-tuner-stream.integration.test.ts', 'integration', ['stream']),
            test('recording-api.spec.test.ts', 'spec'),
        ],
    },
    {
        name: 'load',
        tests: [test('scheduler-load.integration.test.ts', 'integration', ['fake-timer', 'stream', 'filesystem'])],
    },
    {
        name: 'characterization',
        tests: [
            test('characterization.test.ts', 'imp', ['fake-timer', 'stream', 'filesystem']),
            test('change-end-at.imp.test.ts', 'imp', ['fake-timer']),
            test('create-recorded-program-map.imp.test.ts', 'imp'),
            test('drop-checker.imp.test.ts', 'imp', ['fake-timer', 'stream', 'filesystem']),
            test('drop-checker-attach-order.imp.test.ts', 'imp', ['stream', 'filesystem']),
            test('drop-checker-real-ts.integration.test.ts', 'integration', ['stream', 'filesystem']),
            test('dropchecker-finished-error.imp.test.ts', 'imp', ['stream', 'filesystem']),
            test('stop-finish-catch.imp.test.ts', 'imp', ['stream']),
            test('moving-from-tmp.imp.test.ts', 'imp', ['filesystem']),
            test('recorder-residuals.imp.test.ts', 'imp', ['stream']),
            test('recording-manage-extra.imp.test.ts', 'imp'),
            test('time-specified-end-timer.imp.test.ts', 'imp', ['fake-timer', 'stream']),
            test('domain-suite-matrix.imp.test.ts', 'imp', ['filesystem']),
        ],
    },
    {
        name: 'recorded-use-snapshot-gate',
        tests: [
            test('deletion-barrier.spec.test.ts', 'spec', ['fake-timer', 'stream']),
            test('recorded-use.imp.test.ts', 'imp', ['fake-timer']),
            test('recorded-use.integration.test.ts', 'integration'),
            test('recorded-use-capacity.integration.test.ts', 'integration'),
            test('recorded-use.spec.test.ts', 'spec'),
        ],
    },
];

export const recordingExecutionTestTargets = recordingDomainSuiteMatrix.flatMap(suite => suite.tests);
