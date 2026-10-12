import { spawn, type ChildProcess } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * client の e2e を、`page.route` の偽 API ではなく本物の v3 server に繋いで流すための harness。
 * - server の source を一時 directory へ compile し、client の build（`client/dist`）と一緒に置く。
 * - tuner server は loopback の手作りの Mirakurun 互換 server（合成の局 1 つ・番組 2 つ）にする。
 * - DB は一時 directory の sqlite。
 * 一時 directory は `os.tmpdir()`（TMPDIR）の下に作る。
 */

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const repositoryRoot = join(clientRoot, '..')

export const SYNTHETIC_SERVICE = {
  id: 3273601024,
  serviceId: 1024,
  networkId: 32736,
  name: 'synthetic-real-server-channel',
  type: 1,
  remoteControlKeyId: 1,
  hasLogoData: false,
  channel: { type: 'GR', channel: '27' },
}

export const ON_AIR_PROGRAM_NAME = 'synthetic-real-server-onair'
export const NEXT_PROGRAM_NAME = 'synthetic-real-server-next'
export const NEXT_PROGRAM_ID = 327361024002

const syntheticPrograms = (now: number) => {
  const hour = 60 * 60 * 1000
  const base = {
    serviceId: SYNTHETIC_SERVICE.serviceId,
    networkId: SYNTHETIC_SERVICE.networkId,
    isFree: true,
    genres: [{ lv1: 7, lv2: 0, un1: 15, un2: 15 }],
    video: { type: 'mpeg2', resolution: '1080i', streamContent: 1, componentType: 179 },
    audios: [
      { componentType: 3, componentTag: 16, isMain: true, samplingRate: 48000, langs: ['jpn'] },
    ],
  }
  return [
    {
      ...base,
      id: 327361024001,
      eventId: 1,
      startAt: now - Math.floor(hour / 4),
      duration: hour,
      name: ON_AIR_PROGRAM_NAME,
      description: 'synthetic-real-server-description',
    },
    {
      ...base,
      id: NEXT_PROGRAM_ID,
      eventId: 2,
      startAt: now + 2 * hour,
      duration: hour / 2,
      name: NEXT_PROGRAM_NAME,
      description: 'synthetic-real-server-description',
    },
  ]
}

const listen = (server: Server): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })

const unusedPort = async (): Promise<number> => {
  const server = createServer()
  const port = await listen(server)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

const json = (response: ServerResponse, value: unknown, status = 200): void => {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}

export interface RealServerFixture {
  readonly origin: string
  readonly root: string
  stop(): Promise<void>
}

const startTunerServer = async (): Promise<{ origin: string; close(): Promise<void> }> => {
  const now = Date.now()
  const programs = syntheticPrograms(now)
  const sockets = new Set<Socket>()
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    switch (url.pathname) {
      case '/api/status':
        return json(response, { time: Date.now(), version: '4.1.5' })
      case '/api/version':
        return json(response, { current: '4.1.5', latest: '4.1.5' })
      case '/api/config/server':
        return json(response, { port: 40772 })
      case '/api/tuners':
        return json(response, [
          {
            index: 0,
            name: 'synthetic-tuner',
            types: ['GR'],
            command: null,
            pid: null,
            users: [],
            isAvailable: true,
            isRemote: false,
            isFree: true,
            isUsing: false,
            isFault: false,
          },
        ])
      case '/api/services':
        return json(response, [SYNTHETIC_SERVICE])
      case '/api/programs':
        return json(response, programs)
      case '/api/events/stream':
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.write('[\n')
        return
      default: {
        const program = /^\/api\/programs\/(\d+)$/.exec(url.pathname)
        if (program !== null) {
          const found = programs.find((item) => item.id === Number(program[1]))
          return found === undefined ? json(response, { code: 404 }, 404) : json(response, found)
        }
        return json(response, { code: 404 }, 404)
      }
    }
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  const port = await listen(server)
  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

const runToCompletion = (command: string, args: readonly string[], cwd: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (data) => (output += String(data)))
    child.stderr.on('data', (data) => (output += String(data)))
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited ${code}: ${output.slice(-4000)}`)),
    )
  })

const waitForServer = async (
  apiBase: string,
  child: ChildProcess,
  log: () => string,
): Promise<void> => {
  const deadline = Date.now() + 120_000
  let last = 'no response'
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${log()}`)
    try {
      const response = await fetch(`${apiBase}/api/channels`)
      const body = await response.text()
      last = `${response.status} ${body.slice(0, 200)}`
      if (response.ok && (JSON.parse(body) as unknown[]).length > 0) return
    } catch (error) {
      last = String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`server did not become ready (last /api/channels: ${last}): ${log()}`)
}

const killGroup = (child: ChildProcess, signal: NodeJS.Signals): void => {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    child.kill(signal)
  }
}

export interface CompiledServer {
  readonly dist: string
  remove(): Promise<void>
}

/** server の source を一時 directory へ compile する。複数の server の起動で同じ build を使う。 */
export const compileServer = async (): Promise<CompiledServer> => {
  await access(join(clientRoot, 'dist', 'index.html')).catch(() => {
    throw new Error(
      'client/dist is missing. Run `npm run bundle` in client before the real server e2e.',
    )
  })
  const root = await mkdtemp(join(tmpdir(), 'epgstation-client-real-server-build-'))
  try {
    await runToCompletion(
      process.execPath,
      [
        join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
        '-p',
        'tsconfig.json',
        '--outDir',
        join(root, 'dist'),
      ],
      repositoryRoot,
    )
  } catch (error) {
    await rm(root, { force: true, recursive: true })
    throw error
  }
  return { dist: join(root, 'dist'), remove: () => rm(root, { force: true, recursive: true }) }
}

export interface RealServerOptions {
  /** `config.yml` の `subDirectory`。server は API・静的 file・Socket.IO をこの path の下で配る。 */
  readonly subDirectory?: string
}

export const startRealServer = async (
  compiled: CompiledServer,
  options: RealServerOptions = {},
): Promise<RealServerFixture> => {
  const root = await mkdtemp(join(tmpdir(), 'epgstation-client-real-server-'))
  const tuner = await startTunerServer()
  let server: ChildProcess | undefined
  let log = ''
  try {
    await cp(compiled.dist, join(root, 'dist'), { recursive: true })
    await symlink(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
    await Promise.all(
      ['api.yml', 'package.json'].map((file) => cp(join(repositoryRoot, file), join(root, file))),
    )
    await cp(join(repositoryRoot, 'img'), join(root, 'img'), { recursive: true })
    await cp(join(clientRoot, 'dist'), join(root, 'client', 'dist'), { recursive: true })
    await Promise.all(
      [
        'config',
        'data',
        'logs/Operator',
        'logs/Service',
        'logs/EPGUpdater',
        'recorded',
        'thumbnail',
        'streamfiles',
        'drop',
      ].map((directory) => mkdir(join(root, directory), { recursive: true })),
    )
    await Promise.all(
      [
        ['config.yml.template', 'config.yml.template'],
        ['operatorLogConfig.sample.yml', 'operatorLogConfig.yml'],
        ['serviceLogConfig.sample.yml', 'serviceLogConfig.yml'],
        ['epgUpdaterLogConfig.sample.yml', 'epgUpdaterLogConfig.yml'],
      ].map(([source, destination]) =>
        cp(join(repositoryRoot, 'config', source), join(root, 'config', destination)).catch(
          () => undefined,
        ),
      ),
    )
    const port = await unusedPort()
    await writeFile(
      join(root, 'config', 'config.yml'),
      [
        `port: ${port}`,
        `mirakurunPath: ${tuner.origin}`,
        'dbtype: sqlite',
        "recorded: [{ name: 'synthetic-storage', path: '%ROOT%/recorded' }]",
        "thumbnail: '%ROOT%/thumbnail'",
        "streamFilePath: '%ROOT%/streamfiles'",
        // uploadTempDir と dropLog は `%ROOT%` を置き換えない設定の key なので、絶対 path で書く。
        `uploadTempDir: '${join(root, 'data', 'upload')}'`,
        `dropLog: '${join(root, 'drop')}'`,
        'encodeProcessNum: 0',
        'concurrentEncodeNum: 0',
        'encode: []',
        ...(options.subDirectory === undefined ? [] : [`subDirectory: '${options.subDirectory}'`]),
        '',
      ].join('\n'),
      { encoding: 'utf8', mode: 0o600 },
    )
    const origin = `http://127.0.0.1:${port}`
    // server は service と番組情報の更新の子 process を起動する。止めるときに process group ごと止める。
    server = spawn(process.execPath, [join(root, 'dist', 'index.js')], {
      cwd: root,
      detached: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    server.stdout?.on('data', (data) => (log = (log + String(data)).slice(-8000)))
    server.stderr?.on('data', (data) => (log = (log + String(data)).slice(-8000)))
    try {
      await waitForServer(`${origin}${options.subDirectory ?? ''}`, server, () => log)
    } catch (error) {
      const readLog = (path: string) => readFile(join(root, 'logs', path), 'utf8').catch(() => '')
      const serviceLog = await readLog(join('Service', 'system.log'))
      const epgLog = await readLog(join('EPGUpdater', 'system.log'))
      throw new Error(
        `${(error as Error).message}\nservice log: ${serviceLog.slice(-4000)}\nepg updater log: ${epgLog.slice(-4000)}`,
        { cause: error },
      )
    }
    const running = server
    return {
      origin,
      root,
      stop: async () => {
        if (running.exitCode === null && running.signalCode === null) {
          const closed = new Promise<void>((resolve) => running.once('close', () => resolve()))
          killGroup(running, 'SIGTERM')
          const timer = setTimeout(() => killGroup(running, 'SIGKILL'), 15_000)
          await closed
          clearTimeout(timer)
        }
        await tuner.close()
        await rm(root, { force: true, recursive: true })
      },
    }
  } catch (error) {
    if (server !== undefined && server.exitCode === null) killGroup(server, 'SIGKILL')
    await tuner.close()
    await rm(root, { force: true, recursive: true })
    throw error
  }
}
