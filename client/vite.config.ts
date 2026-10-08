import { defineConfig } from 'vitest/config'
import { createLogger } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { availableParallelism } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(packageRoot, '..')
const devProxyTarget = process.env.EPGSTATION_DEV_PROXY_TARGET ?? 'http://127.0.0.1:8888'
const enableCoverageGate = process.env.VITEST_COVERAGE_GATE === '1'
// coverage:gate の fork pool worker 数の上限。既定は CPU 数と 8 の小さい方(8 はこれまで計測した
// 最大値、下の coverage.thresholds 手前のコメント参照)。EPGSTATION_COVERAGE_GATE_MAX_WORKERS が
// 数値で与えられていれば、それを 1〜CPU数 の範囲に収めて使う(下げる方向にだけ効く、
// EPGSTATION_TEST_MAX_WORKERS と同じ考え方)。docker-gate-node24 と同時に
// 走る条件での再計測用。
function boundedCoverageGateMaxWorkers(): number {
  const cpuCount = availableParallelism()
  const raw = process.env.EPGSTATION_COVERAGE_GATE_MAX_WORKERS
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw)
    if (Number.isInteger(parsed) && parsed > 0) {
      return Math.min(parsed, cpuCount, 8)
    }
  }
  return Math.min(cpuCount, 8)
}
const coverageGateMaxWorkers = boundedCoverageGateMaxWorkers()
const suppressProxyErrors = process.env.EPGSTATION_SUPPRESS_PROXY_ERRORS === '1'

export function shouldSuppressProxyErrorLog(message: unknown): boolean {
  return typeof message === 'string' && message.includes('http proxy error:')
}

function createClientLogger() {
  const logger = createLogger()

  if (!suppressProxyErrors) {
    return logger
  }

  const originalError = logger.error.bind(logger)
  logger.error = (...args: Parameters<typeof logger.error>) => {
    if (shouldSuppressProxyErrorLog(args[0])) {
      return
    }

    originalError(...args)
  }

  return logger
}

export function resolveDevServerPortFromHost(host: string | undefined): number | undefined {
  if (host === undefined || host === '') {
    return undefined
  }

  try {
    const parsed = new URL(`http://${host}`)
    const port = Number(parsed.port)

    return Number.isInteger(port) && port > 0 ? port : undefined
  } catch {
    return undefined
  }
}

export function rewriteDevProxyConfigSocketIOPort(
  body: Buffer,
  socketIOPort: number | undefined,
): Buffer {
  if (socketIOPort === undefined) {
    return body
  }

  try {
    const config = JSON.parse(body.toString('utf8')) as unknown

    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      return body
    }

    return Buffer.from(
      JSON.stringify({
        ...config,
        socketIOPort,
      }),
    )
  } catch {
    return body
  }
}

function writeProxyResponse(proxyRes: IncomingMessage, res: ServerResponse, body: Buffer): void {
  res.statusCode = proxyRes.statusCode ?? 500
  Object.entries(proxyRes.headers).forEach(([name, value]) => {
    if (
      value === undefined ||
      name.toLowerCase() === 'content-length' ||
      name.toLowerCase() === 'transfer-encoding'
    ) {
      return
    }

    res.setHeader(name, value)
  })
  res.setHeader('content-length', String(body.byteLength))
  res.end(body)
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  customLogger: createClientLogger(),
  plugins: [react()],
  server: {
    fs: {
      allow: [packageRoot, repositoryRoot],
    },
    proxy: {
      '/api/config': {
        target: devProxyTarget,
        changeOrigin: true,
        selfHandleResponse: true,
        configure(proxy) {
          proxy.on('proxyRes', (proxyRes, req, res) => {
            const chunks: Buffer[] = []

            proxyRes.on('data', (chunk: Buffer | string) => {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
            })
            proxyRes.on('end', () => {
              const rawBody = Buffer.concat(chunks)
              const devServerPort = resolveDevServerPortFromHost(req.headers.host)

              if (proxyRes.statusCode !== 200) {
                writeProxyResponse(proxyRes, res, rawBody)
                return
              }

              const rewrittenBody = rewriteDevProxyConfigSocketIOPort(rawBody, devServerPort)
              res.setHeader('content-type', 'application/json; charset=utf-8')
              writeProxyResponse(proxyRes, res, rewrittenBody)
            })
          })
        },
      },
      '/api': {
        target: devProxyTarget,
        changeOrigin: true,
      },
      '/socket.io': {
        target: devProxyTarget,
        changeOrigin: true,
        ws: true,
      },
      '/streamfiles': {
        target: devProxyTarget,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(packageRoot, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/visual/**'],
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // coverage:gate runs every unittest file (327 files) under v8 coverage instrumentation, whose
    // per-statement collection overhead is CPU-bound. The default fork pool sizing (close to
    // availableParallelism()) oversubscribes the CPU once instrumentation is added: on an idle
    // 16-core host, --maxWorkers=12 let the heaviest test in
    // unittest/spec/storages/upload-submit.spec.test.tsx (the two-video-block upload-order case)
    // intermittently exceed the 5000ms default test timeout, and the unthrottled default (no
    // --maxWorkers) reproduced it in every sampled run. --maxWorkers=8 and --maxWorkers=6 both
    // avoided timeouts across repeated full-suite runs on that 16-core host (up to 97.5% and 83%
    // of the 5000ms budget respectively), but under `taskset -c 0-3` (4 real cores, matching the
    // 4-CPU budget sized like a hosted runner) --maxWorkers=6 oversubscribed those 4 cores and the
    // same test timed out again in 2 of 2 runs, while --maxWorkers=4 (at-or-below the smallest
    // real-core count measured) was clean: 5 of 5 full-suite runs clean unconstrained --
    // 183.19-183.83s total, slowest individual test 3640-3699ms, 73-74% of budget -- and 2 of 2
    // clean under `taskset -c 0-3` -- 222.05-223.27s total, slowest individual test 3906-3951ms,
    // 78-79% of budget.
    //
    // coverage:gate is not run by hosted CI (which only runs lint/typecheck/format:check); it runs
    // by hand or inside the `client`/`client-browser` rehearsal container, which
    // release-preflight.sh gives 8 dedicated CPUs. Measured there (`taskset -c 0-7`, 8 real cores,
    // no SMT siblings sharing those 8): --maxWorkers=8 was clean across 3 consecutive full-suite
    // runs (327 files / 2072 tests all passed, no timeouts, 116.17-117.05s total each), close to 3x
    // faster than --maxWorkers=4 on the same 8-core cpuset (179.74s), which leaves most of the
    // container's CPUs idle. `coverageGateMaxWorkers` (above) keeps this at or below
    // whatever CPU count is actually available, still never higher than the 8 measured here as
    // safe, so a smaller box (e.g. 4 CPUs) falls back to 4 workers. This does
    // not apply outside coverage:gate: plain runs (no coverage instrumentation) do not exhibit this
    // contention.
    //
    // That 8-worker measurement was still in isolation (nothing else sharing the box).
    // release-preflight.sh's `--all` parallel group (docker-gate-node24 / client+client-browser
    // run concurrently, each pinned to its own disjoint CPU set) adds contention that CPU pinning
    // alone does not remove -- shared disk I/O and memory bandwidth from docker-gate-node24's image
    // build/scan. The figures below were measured by actually running the group concurrently (not
    // simulated with taskset alone), while a third chain of real-process server tests also ran on
    // the host; they have not been measured with only the two chains, so the cap stays at the
    // conservative value:
    // --maxWorkers=8 let the same upload-submit.spec.test.tsx test that motivated the original
    // 4-worker cap exceed the 5000ms timeout again (5012ms observed). Lowering to
    // EPGSTATION_COVERAGE_GATE_MAX_WORKERS=4 (which `boundedCoverageGateMaxWorkers` above reads)
    // removed the timeout failure, but the same test still ran at 67-73% of the 5000ms budget under
    // that contention (3356-3640ms) -- better than 8, but short of the 60% target, because the
    // remaining margin loss is from shared I/O/memory bandwidth, not CPU-core oversubscription,
    // which lowering the worker count further would not meaningfully improve. release-preflight.sh
    // sets this env var only for the `client`/`client-browser` steps inside its `--all` parallel
    // group; a standalone `--only client` or `scripts/ci-rehearsal/job.sh ... client-static -` run
    // (e.g. the push-before-hosted-CI use in AGENTS.md) leaves it unset and gets this file's own
    // CPU-count-based default instead.
    maxWorkers: enableCoverageGate ? coverageGateMaxWorkers : undefined,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/test/**', 'src/**/__fixtures__/**', 'src/**/__mocks__/**'],
      thresholds: enableCoverageGate
        ? {
            statements: 100,
            branches: 100,
            functions: 100,
            lines: 100,
          }
        : undefined,
    },
  },
})
