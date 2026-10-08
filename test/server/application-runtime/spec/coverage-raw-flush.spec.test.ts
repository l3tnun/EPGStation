import { afterEach, describe, expect, it, vi } from 'vitest';

const takeCoverageMock = vi.hoisted(() => vi.fn());
const stopCoverageMock = vi.hoisted(() => vi.fn());
vi.mock('node:v8', () => ({ stopCoverage: stopCoverageMock, takeCoverage: takeCoverageMock }));

/**
 * Contract of `flushWorkerRawCoverageIfEnabled` (see `coverage-raw-flush-guard.ts` for why):
 * - every call writes a dump via `v8.takeCoverage()` and never calls `v8.stopCoverage()` inline;
 * - the first call registers, once per process, a SIGTERM listener (`stopCoverage()` then exit) and
 *   an `exit` listener (`stopCoverage()` only), so Node's own exit-time dump -- the one a SIGTERM can
 *   cut mid-write once Node's exit cleanup has removed the SIGTERM listener -- is never written.
 *
 * `vi.resetModules()` + a fresh dynamic import per test resets the module's once-per-process guard.
 */
describe('coverage-raw-flush setup file', () => {
    const originalNodeV8Coverage = process.env.NODE_V8_COVERAGE;

    afterEach(() => {
        takeCoverageMock.mockClear();
        stopCoverageMock.mockClear();
        vi.restoreAllMocks();
        vi.resetModules();
        if (originalNodeV8Coverage === undefined) {
            delete process.env.NODE_V8_COVERAGE;
        } else {
            process.env.NODE_V8_COVERAGE = originalNodeV8Coverage;
        }
    });

    it('calls v8.takeCoverage() when NODE_V8_COVERAGE is set', async () => {
        process.env.NODE_V8_COVERAGE = '/tmp/some-raw-coverage-dir';
        vi.spyOn(process, 'once').mockImplementation((() => process) as typeof process.once);
        const { flushWorkerRawCoverageIfEnabled } = await import('../../harness/coverage-raw-flush-guard.ts');

        flushWorkerRawCoverageIfEnabled();

        expect(takeCoverageMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT call v8.stopCoverage() synchronously -- only the registered SIGTERM handler does, later', async () => {
        process.env.NODE_V8_COVERAGE = '/tmp/some-raw-coverage-dir';
        vi.spyOn(process, 'once').mockImplementation((() => process) as typeof process.once);
        const { flushWorkerRawCoverageIfEnabled } = await import('../../harness/coverage-raw-flush-guard.ts');

        flushWorkerRawCoverageIfEnabled();

        expect(stopCoverageMock).not.toHaveBeenCalled();
    });

    it('does not call v8.takeCoverage() or v8.stopCoverage() when NODE_V8_COVERAGE is unset', async () => {
        delete process.env.NODE_V8_COVERAGE;
        const onceSpy = vi.spyOn(process, 'once');
        const { flushWorkerRawCoverageIfEnabled } = await import('../../harness/coverage-raw-flush-guard.ts');

        flushWorkerRawCoverageIfEnabled();

        expect(takeCoverageMock).not.toHaveBeenCalled();
        expect(stopCoverageMock).not.toHaveBeenCalled();
        expect(onceSpy).not.toHaveBeenCalled();
    });

    it('registers exactly one SIGTERM listener and one exit listener across many calls', async () => {
        process.env.NODE_V8_COVERAGE = '/tmp/some-raw-coverage-dir';
        const onceSpy = vi.spyOn(process, 'once').mockImplementation((() => process) as typeof process.once);
        const { flushWorkerRawCoverageIfEnabled } = await import('../../harness/coverage-raw-flush-guard.ts');

        flushWorkerRawCoverageIfEnabled();
        flushWorkerRawCoverageIfEnabled();
        flushWorkerRawCoverageIfEnabled();

        expect(onceSpy.mock.calls.map(([event]) => event)).toEqual(['SIGTERM', 'exit']);
        // Every call still flushes -- only the listener registration is one-shot.
        expect(takeCoverageMock).toHaveBeenCalledTimes(3);
    });

    it('the registered SIGTERM handler calls ONLY v8.stopCoverage() (never takeCoverage()) and then exits, only once triggered', async () => {
        // A takeCoverage() here would write a dump while the pool's SIGKILL escalation is already armed.
        process.env.NODE_V8_COVERAGE = '/tmp/some-raw-coverage-dir';
        let sigtermHandler: (() => void) | undefined;
        vi.spyOn(process, 'once').mockImplementation(((event: string, handler: () => void) => {
            if (event === 'SIGTERM') {
                sigtermHandler = handler;
            }
            return process;
        }) as typeof process.once);
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        const callOrder: string[] = [];
        takeCoverageMock.mockImplementation(() => callOrder.push('takeCoverage'));
        stopCoverageMock.mockImplementation(() => callOrder.push('stopCoverage'));
        const { flushWorkerRawCoverageIfEnabled } = await import('../../harness/coverage-raw-flush-guard.ts');

        flushWorkerRawCoverageIfEnabled();
        expect(sigtermHandler).toBeDefined();
        callOrder.length = 0; // discard the per-call takeCoverage() above; only the handler's own sequence matters below.
        takeCoverageMock.mockClear();

        sigtermHandler?.();

        expect(callOrder).toEqual(['stopCoverage']);
        expect(takeCoverageMock).not.toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledTimes(1);
    });

    it('the registered exit listener calls ONLY v8.stopCoverage() -- no dump, no exit -- so Node writes no exit-time dump', async () => {
        process.env.NODE_V8_COVERAGE = '/tmp/some-raw-coverage-dir';
        let exitListener: (() => void) | undefined;
        vi.spyOn(process, 'once').mockImplementation(((event: string, listener: () => void) => {
            if (event === 'exit') {
                exitListener = listener;
            }
            return process;
        }) as typeof process.once);
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        const { flushWorkerRawCoverageIfEnabled } = await import('../../harness/coverage-raw-flush-guard.ts');

        flushWorkerRawCoverageIfEnabled();
        expect(exitListener).toBeDefined();
        takeCoverageMock.mockClear();

        exitListener?.();

        expect(stopCoverageMock).toHaveBeenCalledTimes(1);
        expect(takeCoverageMock).not.toHaveBeenCalled();
        expect(exitSpy).not.toHaveBeenCalled();
    });
});
