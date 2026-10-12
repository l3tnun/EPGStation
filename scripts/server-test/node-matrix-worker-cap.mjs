/**
 * Shared Vitest worker cap for the node-matrix's two Node major legs (`run-coverage-gate-cli.mjs`
 * for Node 24, `run-node-acceptance-matrix.mjs` for Node 26). Both majors run the same server
 * suite once, so both must be bounded to the same concurrency, instead of only the Node 24 leg
 * narrowing to this cap while the Node 26 leg inherits whatever `EPGSTATION_TEST_MAX_WORKERS` the
 * caller (e.g. `release-preflight.sh`, sized from `availableParallelism()`) happened to set
 * uncapped.
 *
 * 値は開発機 (16 thread / 30G) を基準にした 8。両 major が同じ値を共有するという上の contract を
 * 保つ。PR の CI は server test を流さないので、hosted runner (4 CPU) の形には合わせない。
 * Node 24 の回 (coverage) は `Math.min(cap, 8)` に別途キャリブレーションされており、
 * この cap が 8 であることと一致する。Node 26 の回 (coverage なし) は
 * 8 で動かし、16 では entry-export-guard / thumbnail-process など複数の test が負荷で落ちるため、
 * 8 を超えて上げない。
 */
export const NODE_MATRIX_MAX_WORKERS = 8;

/**
 * Resolves the effective `EPGSTATION_TEST_MAX_WORKERS` value for a node-matrix leg: at most
 * `NODE_MATRIX_MAX_WORKERS`. Never raises it -- an unset or invalid value defaults to the cap; a
 * caller that already set a stricter (lower) value keeps it.
 */
export function boundedNodeMatrixWorkerCount(baseEnv) {
    const requestedCap = Number.parseInt(baseEnv?.EPGSTATION_TEST_MAX_WORKERS ?? '', 10);
    return Number.isInteger(requestedCap) && requestedCap > 0
        ? Math.min(requestedCap, NODE_MATRIX_MAX_WORKERS)
        : NODE_MATRIX_MAX_WORKERS;
}
