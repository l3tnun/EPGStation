#!/usr/bin/env node

import { spawn } from 'node:child_process'

const host = process.env.VITE_DEV_SMOKE_HOST ?? '127.0.0.1'
const port = Number(process.env.VITE_DEV_SMOKE_PORT ?? 5173)
const baseUrl = process.env.VITE_DEV_SMOKE_URL ?? `http://${host}:${port}`
const timeoutMs = Number(process.env.VITE_DEV_SMOKE_TIMEOUT_MS ?? 30_000)

const checks = [
  {
    path: '/src/features/search/rule/index.ts',
    description: 'search rule barrel export',
    requiredPattern: /\bSearchRulePage\b/,
    variants: ['plain', 'cache-busted'],
  },
  {
    path: '/src/features/search/rule/SearchRulePage.tsx',
    description: 'SearchRulePage dev module transform',
    requiredPattern: /\bexport function SearchRulePage\b/,
    variants: ['plain', 'cache-busted', 'vite-timestamp'],
  },
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const withQuery = (path, query) => {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}${query}`
}

const withCacheBuster = (path) => {
  return withQuery(path, `dev-smoke=${Date.now()}`)
}

const withViteTimestamp = (path) => {
  return withQuery(path, `t=${Date.now()}`)
}

const fail = (message) => {
  console.error(`Vite dev server smoke failed: ${message}`)
  process.exitCode = 1
}

const fetchText = async (path, timeout = 5_000) => {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(timeout),
    headers: {
      'cache-control': 'no-cache',
    },
  })

  return {
    response,
    text: await response.text(),
  }
}

const isServerAvailable = async () => {
  try {
    const response = await fetch(baseUrl, {
      signal: AbortSignal.timeout(1_000),
      headers: {
        'cache-control': 'no-cache',
      },
    })

    return response.ok || response.status < 500
  } catch {
    return false
  }
}

const waitForServer = async (serverProcess) => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Vite dev server exited early with code ${serverProcess.exitCode}`)
    }

    if (await isServerAvailable()) {
      return
    }

    await sleep(250)
  }

  throw new Error(`Timed out waiting for Vite dev server at ${baseUrl}`)
}

const startServer = () => {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const serverProcess = spawn(
    npmCommand,
    ['run', 'dev', '--', '--host', host, '--port', String(port), '--strictPort', '--force'],
    {
      cwd: new URL('..', import.meta.url),
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  serverProcess.stdout.on('data', (chunk) => {
    if (process.env.VITE_DEV_SMOKE_VERBOSE === '1') {
      process.stdout.write(chunk)
    }
  })
  serverProcess.stderr.on('data', (chunk) => {
    if (process.env.VITE_DEV_SMOKE_VERBOSE === '1') {
      process.stderr.write(chunk)
    }
  })

  return serverProcess
}

const stopServer = async (serverProcess) => {
  if (!serverProcess || serverProcess.exitCode !== null) {
    return
  }

  const killServer = (signal) => {
    if (process.platform === 'win32') {
      serverProcess.kill(signal)
      return
    }

    try {
      process.kill(-serverProcess.pid, signal)
    } catch {
      serverProcess.kill(signal)
    }
  }

  killServer('SIGTERM')

  const deadline = Date.now() + 5_000
  while (serverProcess.exitCode === null && Date.now() < deadline) {
    await sleep(100)
  }

  if (serverProcess.exitCode === null) {
    killServer('SIGKILL')
  }
}

const verifyDevModules = async () => {
  for (const check of checks) {
    for (const variant of check.variants) {
      const path =
        variant === 'cache-busted'
          ? withCacheBuster(check.path)
          : variant === 'vite-timestamp'
            ? withViteTimestamp(check.path)
            : check.path
      const variantDescription = `${check.description} (${variant})`
      const { response, text } = await fetchText(path)

      if (!response.ok) {
        throw new Error(`${variantDescription} returned HTTP ${response.status}`)
      }

      const trimmed = text.trim()
      const isEmptySourcemapOnly =
        trimmed.startsWith('//# sourceMappingURL=data:application/json') &&
        /"sourcesContent":\[""\]/.test(trimmed)

      if (trimmed.length === 0 || isEmptySourcemapOnly) {
        throw new Error(`${variantDescription} returned an empty transformed module`)
      }

      if (!check.requiredPattern.test(text)) {
        const snippet = trimmed.slice(0, 240).replace(/\s+/g, ' ')
        throw new Error(
          `${variantDescription} did not include ${check.requiredPattern.toString()}. ` +
            `Snippet: ${snippet}`,
        )
      }
    }
  }
}

const main = async () => {
  let spawnedServer = null
  const hadExistingServer = await isServerAvailable()

  if (!hadExistingServer) {
    spawnedServer = startServer()
    await waitForServer(spawnedServer)
  }

  try {
    await verifyDevModules()
    console.log(
      `Vite dev server smoke passed at ${baseUrl} ` +
        `(${hadExistingServer ? 'existing server' : 'temporary server'})`,
    )
  } finally {
    await stopServer(spawnedServer)
  }
}

main().catch(async (error) => {
  fail(error instanceof Error ? error.message : String(error))
})
