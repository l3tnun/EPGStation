#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ERROR_PATTERN = /取得に失敗|エラー|\bError\b/
const DEFAULT_DEVICE_TARGET = process.env.EPGSTATION_DEVICE_TARGET ?? 'all'
const ROUTES = [
  { route: '#/', expected: 'EPGStation', state: 'dashboard' },
  { route: '#/guide', expected: '番組表', state: 'guide' },
  { route: '#/onair', expected: '放映中', state: 'onair' },
  { route: '#/recorded', expected: '録画済み', state: 'recorded' },
  { route: '#/reserves', expected: '予約', state: 'reserves' },
  { route: '#/search', expected: '検索', state: 'search' },
  { route: '#/rule', expected: 'ルール', state: 'rule' },
  { route: '#/encode', expected: 'エンコード', state: 'encode' },
  { route: '#/storages', expected: 'ストレージ', state: 'storages' },
  { route: '#/settings', expected: '設定', state: 'settings' },
]

const WORKFLOW_STATES = [
  { state: 'navigation-guide', expected: '番組表', expectedValues: ['番組表'] },
  {
    state: 'onair-stream-dialog',
    expected: 'ストリーム選択',
    expectedValues: ['ストリーム選択', '配信方式', '画質', '放映中'],
  },
  {
    state: 'guide-program-dialog',
    expected: '予約',
    expectedValues: ['予約', '番組詳細', 'エンコード', '番組表'],
  },
  {
    state: 'recorded-detail',
    expected: '録画詳細',
    expectedValues: ['録画詳細', '番組詳細', 'streaming'],
  },
  {
    state: 'recorded-streaming-dialog',
    expected: 'Streaming',
    expectedValues: ['ストリーム選択', 'streaming', 'STREAMING', 'WebM', 'MP4', 'HLS', 'TS'],
  },
  { state: 'dark-dashboard', expected: 'EPGStation', expectedValues: ['EPGStation'] },
  {
    state: 'dark-navigation-drawer-open',
    expected: 'EPGStation',
    expectedValues: ['EPGStation', 'ダッシュボード'],
  },
]

const IOS_OVERSCROLL_ROUTES = [
  { route: '#/', expected: 'EPGStation', state: 'dashboard' },
  { route: '#/recorded', expected: '録画済み', state: 'recorded' },
  { route: '#/search', expected: '検索', state: 'search' },
  { route: '#/rule', expected: 'ルール', state: 'rule' },
  { route: '#/settings', expected: '設定', state: 'settings' },
]

const REQUIRED_ENV = {
  shared: ['EPGSTATION_CURRENT_UI_URL'],
  android: [
    'EPGSTATION_ANDROID_JAVA_HOME',
    'EPGSTATION_ANDROID_SDK_ROOT',
    'EPGSTATION_ANDROID_AVD_NAME',
    'EPGSTATION_ANDROID_APPIUM_URL',
    'EPGSTATION_ANDROID_APPIUM_WORKDIR',
  ],
  ios: [
    'EPGSTATION_IOS_MAC_SSH_HOST',
    'EPGSTATION_IOS_MAC_NODE_BIN_DIR',
    'EPGSTATION_IOS_MAC_APPIUM_WORKDIR',
    'EPGSTATION_IOS_MAC_APPIUM_LOG',
    'EPGSTATION_IOS_MAC_APPIUM_PID_FILE',
    'EPGSTATION_IOS_APPIUM_URL',
    'EPGSTATION_IOS_SIM_DEVICE_NAME',
  ],
}

function main() {
  run()
    .then(() => undefined)
    .catch((error) => {
      console.error(`[device] failed: ${sanitizeMessage(error.message)}`)
      process.exitCode = 1
    })
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  const suite = args.suite ?? 'smoke'
  const target = args.device ?? DEFAULT_DEVICE_TARGET
  const repoRoot = findRepoRoot(process.cwd())
  const envFile = path.join(repoRoot, 'client/device/.device-lab.local.env')
  const localEnv = applyProcessEnvOverrides(loadEnvFile(envFile), [
    ...REQUIRED_ENV.shared,
    ...REQUIRED_ENV.android,
    ...REQUIRED_ENV.ios,
  ])
  const devices = resolveDevices(target)
  const suites = suite === 'all' ? ['smoke', 'workflow', 'visual'] : [suite]

  for (const device of devices) {
    assertEnv(localEnv, [...REQUIRED_ENV.shared, ...REQUIRED_ENV[device]])
  }

  const allResults = []
  for (const device of devices) {
    await withDevice(device, repoRoot, localEnv, async (context) => {
      for (const suiteName of suites) {
        const results = await runSuite(suiteName, context)
        allResults.push(...results)
        printSuiteSummary(device, suiteName, results)
      }
    })
  }

  const failures = allResults.filter((result) => result.status !== 'passed')
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(
        `[device] FAIL ${failure.device}/${failure.suite}/${failure.state}: ${sanitizeMessage(failure.message)}`,
      )
    }
    throw new Error(`${failures.length} device case(s) failed`)
  }

  console.log(`[device] passed ${allResults.length} case(s)`)
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--suite') {
      args.suite = argv[index + 1]
      index += 1
    } else if (current === '--device') {
      args.device = argv[index + 1]
      index += 1
    } else if (current === '--help' || current === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`unknown argument: ${current}`)
    }
  }

  if (
    args.suite !== undefined &&
    !['smoke', 'workflow', 'visual', 'overscroll', 'all'].includes(args.suite)
  ) {
    throw new Error(`unsupported suite: ${args.suite}`)
  }

  return args
}

function printHelp() {
  console.log(`Usage: node device/run-device-tests.mjs --suite smoke|workflow|visual|overscroll|all [--device android|ios|all]

Environment:
  Reads client/device/.device-lab.local.env.
  Use EPGSTATION_DEVICE_TARGET=android|ios|all to select a device without changing npm scripts.
`)
}

function findRepoRoot(start) {
  let current = path.resolve(start)
  while (current !== path.dirname(current)) {
    if (
      existsSync(path.join(current, 'client/package.json')) &&
      existsSync(path.join(current, 'client/device/.device-lab.local.env.template'))
    ) {
      return current
    }
    current = path.dirname(current)
  }
  throw new Error('repository root was not found')
}

function loadEnvFile(envFile) {
  if (!existsSync(envFile)) {
    throw new Error('device lab env file is missing')
  }

  const output = {}
  const lines = readFileSync(envFile, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed)
    if (match === null) {
      continue
    }
    output[match[1]] = parseEnvValue(match[2])
  }
  return output
}

function applyProcessEnvOverrides(env, keys) {
  const output = { ...env }
  for (const key of keys) {
    if (process.env[key] !== undefined && process.env[key] !== '') {
      output[key] = process.env[key]
    }
  }
  return output
}

function parseEnvValue(rawValue) {
  const value = rawValue.trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const inner = value.slice(1, -1)
    return value.startsWith('"')
      ? inner.replace(/\\(["\\$`nrt])/g, (_match, escaped) => {
          if (escaped === 'n') return '\n'
          if (escaped === 'r') return '\r'
          if (escaped === 't') return '\t'
          return escaped
        })
      : inner
  }
  return value
}

function assertEnv(env, keys) {
  const missing = keys.filter(
    (key) => env[key] === undefined || env[key] === '' || env[key].startsWith('<'),
  )
  if (missing.length > 0) {
    throw new Error(`device lab env is incomplete: ${missing.join(', ')}`)
  }
}

function resolveDevices(target) {
  if (target === 'all') return ['android', 'ios']
  if (target === 'android' || target === 'ios') return [target]
  throw new Error(`unsupported device target: ${target}`)
}

async function withDevice(device, repoRoot, env, callback) {
  const setup = device === 'android' ? setupAndroid : setupIos
  const context = await setup(repoRoot, env)
  try {
    await callback(context)
  } finally {
    await context.cleanup()
  }
}

async function setupAndroid(repoRoot, env) {
  const appiumUrl = env.EPGSTATION_ANDROID_APPIUM_URL
  const androidEnv = {
    ...process.env,
    JAVA_HOME: env.EPGSTATION_ANDROID_JAVA_HOME,
    ANDROID_SDK_ROOT: env.EPGSTATION_ANDROID_SDK_ROOT,
    PATH: [
      path.join(env.EPGSTATION_ANDROID_SDK_ROOT, 'platform-tools'),
      path.join(env.EPGSTATION_ANDROID_SDK_ROOT, 'emulator'),
      path.join(env.EPGSTATION_ANDROID_SDK_ROOT, 'cmdline-tools/latest/bin'),
      path.join(env.EPGSTATION_ANDROID_JAVA_HOME, 'bin'),
      process.env.PATH ?? '',
    ].join(path.delimiter),
  }
  if (env.EPGSTATION_ANDROID_AVD_HOME && !env.EPGSTATION_ANDROID_AVD_HOME.startsWith('<')) {
    androidEnv.ANDROID_AVD_HOME = env.EPGSTATION_ANDROID_AVD_HOME
  }

  runCommand('adb', ['start-server'], { env: androidEnv, timeoutMs: 30000 })
  const wasBooted = isAndroidBooted(androidEnv)
  let emulatorProcess
  if (!wasBooted) {
    emulatorProcess = spawnManagedProcess(
      'android-emulator',
      'emulator',
      [
        '-avd',
        env.EPGSTATION_ANDROID_AVD_NAME,
        '-no-window',
        '-no-snapshot-save',
        '-no-boot-anim',
        '-no-audio',
        '-no-metrics',
        '-gpu',
        'swiftshader_indirect',
      ],
      { env: androidEnv },
    )
    await waitForAndroidBoot(androidEnv)
  }

  const appiumProcess = spawnManagedProcess(
    'android-appium',
    './node_modules/.bin/appium',
    [
      '--address',
      '127.0.0.1',
      '--port',
      String(new URL(appiumUrl).port || '4723'),
      '--base-path',
      '/',
      '--allow-insecure',
      'uiautomator2:chromedriver_autodownload',
    ],
    { cwd: env.EPGSTATION_ANDROID_APPIUM_WORKDIR, env: androidEnv },
  )
  await waitForAppium(appiumUrl)

  return {
    device: 'android',
    repoRoot,
    baseUrl: env.EPGSTATION_CURRENT_UI_URL,
    appiumUrl,
    artifactRoot: path.join(repoRoot, 'client/device/artifacts/android'),
    createClient: async () => {
      const client = new AppiumClient(appiumUrl)
      await client.createSession({
        capabilities: {
          alwaysMatch: {
            platformName: 'Android',
            'appium:automationName': 'UiAutomator2',
            browserName: 'Chrome',
            'appium:newCommandTimeout': 300,
          },
        },
      })
      await client.switchToWebContext()
      return client
    },
    cleanup: async () => {
      await stopManagedProcess(appiumProcess)
      if (!wasBooted) {
        try {
          runCommand('adb', ['emu', 'kill'], { env: androidEnv, timeoutMs: 15000 })
        } catch {
          await stopManagedProcess(emulatorProcess)
        }
      }
    },
  }
}

function isAndroidBooted(env) {
  try {
    const output = runCommand('adb', ['shell', 'getprop', 'sys.boot_completed'], {
      env,
      timeoutMs: 5000,
      allowFailure: true,
    })
    return output.trim() === '1'
  } catch {
    return false
  }
}

async function waitForAndroidBoot(env) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 180000) {
    if (isAndroidBooted(env)) {
      return
    }
    await delay(3000)
  }
  throw new Error('Android emulator did not boot in time')
}

async function setupIos(repoRoot, env) {
  const appiumUrl = env.EPGSTATION_IOS_APPIUM_URL
  const remotePort = String(new URL(appiumUrl).port || '4723')
  const localPort = remotePort
  const remoteBootOutput = runSsh(
    env.EPGSTATION_IOS_MAC_SSH_HOST,
    [
      'set -e',
      'open -a Simulator >/dev/null 2>&1 || true',
      `xcrun simctl boot ${shQuote(env.EPGSTATION_IOS_SIM_DEVICE_NAME)} >/dev/null 2>&1 || true`,
      'xcrun simctl list devices booted',
    ].join('\n'),
    { timeoutMs: 60000 },
  )
  const udid = extractBootedUdid(remoteBootOutput, env.EPGSTATION_IOS_SIM_DEVICE_NAME)
  if (udid === undefined) {
    throw new Error('iOS booted simulator UDID was not found')
  }

  runSsh(
    env.EPGSTATION_IOS_MAC_SSH_HOST,
    [
      'set -e',
      `export PATH=${shQuote(env.EPGSTATION_IOS_MAC_NODE_BIN_DIR)}:"$PATH"`,
      `cd ${shQuote(env.EPGSTATION_IOS_MAC_APPIUM_WORKDIR)}`,
      `if [ -f ${shQuote(env.EPGSTATION_IOS_MAC_APPIUM_PID_FILE)} ]; then kill "$(cat ${shQuote(
        env.EPGSTATION_IOS_MAC_APPIUM_PID_FILE,
      )})" >/dev/null 2>&1 || true; fi`,
      `nohup ./node_modules/.bin/appium --address 127.0.0.1 --port ${remotePort} --base-path / > ${shQuote(
        env.EPGSTATION_IOS_MAC_APPIUM_LOG,
      )} 2>&1 &`,
      `echo $! > ${shQuote(env.EPGSTATION_IOS_MAC_APPIUM_PID_FILE)}`,
    ].join('\n'),
    { timeoutMs: 30000 },
  )

  const forwardProcess = spawnManagedProcess(
    'ios-port-forward',
    'ssh',
    ['-N', '-L', `${localPort}:127.0.0.1:${remotePort}`, env.EPGSTATION_IOS_MAC_SSH_HOST],
    { env: process.env },
  )
  await waitForAppium(appiumUrl)

  return {
    device: 'ios',
    repoRoot,
    baseUrl: env.EPGSTATION_CURRENT_UI_URL,
    appiumUrl,
    artifactRoot: path.join(repoRoot, 'client/device/artifacts/ios'),
    createClient: async () => {
      const client = new AppiumClient(appiumUrl)
      await client.createSession({
        capabilities: {
          alwaysMatch: {
            platformName: 'iOS',
            'appium:automationName': 'XCUITest',
            'appium:udid': udid,
            browserName: 'Safari',
            pageLoadStrategy: 'none',
            'appium:newCommandTimeout': 300,
            'appium:includeSafariInWebviews': true,
          },
        },
      })
      await client.switchToWebContext()
      return client
    },
    openUrl: async (url) => {
      runSsh(env.EPGSTATION_IOS_MAC_SSH_HOST, `xcrun simctl openurl booted ${shQuote(url)}`, {
        timeoutMs: 15000,
      })
    },
    cleanup: async () => {
      await stopManagedProcess(forwardProcess)
      try {
        runSsh(
          env.EPGSTATION_IOS_MAC_SSH_HOST,
          `if [ -f ${shQuote(env.EPGSTATION_IOS_MAC_APPIUM_PID_FILE)} ]; then kill "$(cat ${shQuote(
            env.EPGSTATION_IOS_MAC_APPIUM_PID_FILE,
          )})" >/dev/null 2>&1 || true; fi`,
          { timeoutMs: 15000 },
        )
      } catch {
        // Cleanup must not hide the original test result.
      }
    },
  }
}

function extractBootedUdid(output, deviceName) {
  const escapedDeviceName = escapeRegExp(deviceName)
  const exactDeviceMatch = new RegExp(
    `^\\s*${escapedDeviceName}\\s+\\(([0-9A-Fa-f-]{36})\\)\\s+\\(Booted\\)`,
    'm',
  ).exec(output)
  if (exactDeviceMatch !== null) {
    return exactDeviceMatch[1]
  }

  const match = /\(([0-9A-Fa-f-]{36})\)\s+\(Booted\)/.exec(output)
  return match?.[1]
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function runSuite(suite, context) {
  if (suite === 'smoke') return runSmokeSuite(context)
  if (suite === 'workflow') return runWorkflowSuite(context)
  if (suite === 'visual') return runVisualSuite(context)
  if (suite === 'overscroll') return runOverscrollSuite(context)
  throw new Error(`unsupported suite: ${suite}`)
}

async function runSmokeSuite(context) {
  const client = await context.createClient()
  try {
    const results = []
    for (const route of ROUTES) {
      results.push(
        await runCase(context, client, 'smoke', route.state, route.expected, async () => {
          await navigateAndWait(client, context.baseUrl, route.route)
          const state = await readPageState(client)
          assertIncludes(state.title, route.expected, 'document.title')
          assertIncludes(state.route, route.route, 'location')
          assertIncludes(state.bodyText, route.expected, 'body')
          assertHealthyState(state)
          return state
        }),
      )
    }
    return results
  } finally {
    await client.deleteSession()
  }
}

async function runWorkflowSuite(context) {
  const client = await context.createClient()
  try {
    const results = []
    results.push(
      await runCase(context, client, 'workflow', 'navigation-guide', '番組表', async () => {
        await navigateAndWait(client, context.baseUrl, '#/')
        await runWorkflowAction(client, 'openNavigationDrawer')
        const state = await runWorkflowAction(client, 'clickGuideNavigationItem')
        assertIncludes(state.route, '#/guide', 'location')
        assertIncludes(state.fullText, '番組表', 'page')
        assertHealthyState(state)
        return state
      }),
    )

    results.push(
      await runCase(
        context,
        client,
        'workflow',
        'onair-stream-dialog',
        'ストリーム選択',
        async () => {
          await navigateAndWait(client, context.baseUrl, '#/onair')
          const state = await runWorkflowAction(client, 'openOnAirStreamDialog')
          assertIncludesAny(
            state.fullText,
            ['ストリーム選択', '配信方式', '画質', '放映中'],
            'page',
          )
          assertHealthyState(state)
          return state
        },
      ),
    )

    results.push(
      await runCase(context, client, 'workflow', 'guide-program-dialog', '予約', async () => {
        await navigateAndWait(client, context.baseUrl, '#/guide')
        const state = await runWorkflowAction(client, 'openGuideProgramDialog')
        assertIncludesAny(state.fullText, ['予約', '番組詳細', 'エンコード', '番組表'], 'page')
        assertHealthyState(state)
        return state
      }),
    )

    results.push(
      await runCase(context, client, 'workflow', 'recorded-detail', '録画詳細', async () => {
        await navigateAndWait(client, context.baseUrl, '#/recorded')
        const state = await runWorkflowAction(client, 'openRecordedDetail')
        assertIncludesAny(state.fullText, ['録画詳細', '番組詳細', 'streaming'], 'page')
        assertHealthyState(state)
        return state
      }),
    )

    results.push(
      await runCase(
        context,
        client,
        'workflow',
        'recorded-streaming-dialog',
        'Streaming',
        async () => {
          const state = await runWorkflowAction(client, 'openRecordedStreamingDialog')
          assertIncludesAny(
            state.fullText,
            ['ストリーム選択', 'streaming', 'STREAMING', 'WebM', 'MP4', 'HLS', 'TS'],
            'page',
          )
          assertHealthyState(state)
          return state
        },
      ),
    )

    results.push(
      await runCase(
        context,
        client,
        'workflow',
        'initial-display-pages',
        'EPGStation',
        async () => {
          for (const route of ROUTES.filter((item) => item.route !== '#/')) {
            await navigateAndWait(client, context.baseUrl, route.route)
            const state = await readPageState(client)
            assertIncludes(state.fullText, route.expected, 'page')
            assertHealthyState(state)
          }
          return readPageState(client)
        },
      ),
    )

    results.push(
      await runCase(
        context,
        client,
        'workflow',
        'dark-mode-readability',
        'EPGStation',
        async () => {
          await persistDarkThemeSettings(client, context.baseUrl)
          for (const route of ['#/', '#/guide', '#/recorded', '#/search', '#/rule', '#/settings']) {
            await navigateAndWait(client, context.baseUrl, route)
            const state = await readPageState(client)
            await assertDarkThemeState(client, state)
            assertHealthyState(state)
            if (state.bodyLength < 1) {
              throw new Error(`body is empty after dark mode on ${route}`)
            }
          }
          return readPageState(client)
        },
      ),
    )

    results.push(
      await runCase(
        context,
        client,
        'workflow',
        'dark-navigation-drawer-open',
        'EPGStation',
        async () => {
          await persistDarkThemeSettings(client, context.baseUrl)
          await navigateAndWait(client, context.baseUrl, '#/')
          await runWorkflowAction(client, 'openNavigationDrawer')
          const state = await readPageState(client)
          await assertDarkThemeState(client, state)
          assertIncludesAny(state.fullText, ['EPGStation', 'ダッシュボード'], 'drawer')
          const failures = await readDarkContrastFailures(
            client,
            '[data-testid="shell-drawer"], .v-navigation-drawer, nav, [role="navigation"]',
          )
          if (failures.length > 0) {
            throw new Error(
              `dark drawer contrast failures: ${JSON.stringify(failures.slice(0, 5))}`,
            )
          }
          assertHealthyState(state)
          return state
        },
      ),
    )

    return results
  } finally {
    await client.deleteSession()
  }
}

async function persistDarkThemeSettings(client, baseUrl) {
  await client.navigate(resolveRouteUrl(baseUrl, '#/settings'))
  await delay(1000)
  await client.switchToWebContext()
  await client.execute(`
    let settings = {};
    try {
      settings = JSON.parse(window.localStorage.getItem('settings') || '{}') || {};
    } catch {
      settings = {};
    }
    window.localStorage.setItem(
      'settings',
      JSON.stringify({
        ...settings,
        shouldUseOSColorTheme: false,
        isForceDarkTheme: true,
      }),
    );
  `)
  await client.navigate(resolveRouteUrlWithDocumentQuery(baseUrl, '#/settings', 'deviceTheme'))
  await delay(3500)
  await client.switchToWebContext()
  await waitForStableBody(client)
}

async function assertDarkThemeState(client, state) {
  if (String(state.themeMode).includes('dark')) {
    return
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const debug = await readThemeDebugState(client)
    if (
      String(debug.themeMode).includes('dark') ||
      String(debug.bodyThemeMode).includes('dark') ||
      String(debug.documentThemeMode).includes('dark') ||
      String(debug.appShellThemeMode).includes('dark') ||
      debug.hasDarkComputedSurface === true
    ) {
      return
    }
    await delay(500)
  }

  const debug = await readThemeDebugState(client)
  throw new Error(`theme mode did not include expected text: ${JSON.stringify(debug)}`)
}

async function readThemeDebugState(client) {
  return client.execute(`
    const parseRgb = (value) => {
      const match = String(value).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
      if (!match) return null;
      return [Number(match[1]), Number(match[2]), Number(match[3])];
    };
    const luminance = (rgb) => {
      if (!rgb) return 255;
      const [r, g, b] = rgb.map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const surface =
      document.querySelector('[data-testid="app-shell"], .v-application, main, body') ||
      document.body;
    const surfaceBackground = window.getComputedStyle(surface).backgroundColor;
    const settingsText = window.localStorage.getItem('settings') || null;
    let settings = {};
    try {
      settings = JSON.parse(settingsText || '{}') || {};
    } catch {
      settings = {};
    }
    return {
      href: window.location.href,
      themeMode: document.querySelector('[data-theme-mode]')?.getAttribute('data-theme-mode') || '',
      appShellThemeMode: document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-theme-mode') || '',
      documentThemeMode: document.documentElement.dataset.themeMode || '',
      bodyThemeMode: document.body.dataset.themeMode || '',
      hasDarkComputedSurface:
        settings.shouldUseOSColorTheme === false &&
        settings.isForceDarkTheme === true &&
        luminance(parseRgb(surfaceBackground)) < 0.18,
      surfaceBackground,
      settings: settingsText,
    };
  `)
}

async function runVisualSuite(context) {
  const client = await context.createClient()
  try {
    const results = []
    const manifest = []
    for (const route of ROUTES) {
      results.push(
        await runCase(
          context,
          client,
          'visual',
          route.state,
          route.expected,
          async () => {
            await navigateAndWait(client, context.baseUrl, route.route)
            const state = await readPageState(client)
            assertIncludes(state.bodyText, route.expected, 'body')
            assertHealthyState(state)
            return state
          },
          manifest,
        ),
      )
    }

    for (const state of WORKFLOW_STATES) {
      results.push(
        await runCase(
          context,
          client,
          'visual',
          state.state,
          state.expected,
          async () => {
            await bringWorkflowState(client, context, state.state)
            const pageState = await readPageState(client)
            assertIncludesAny(pageState.fullText, state.expectedValues, 'page')
            assertHealthyState(pageState)
            return pageState
          },
          manifest,
        ),
      )
    }

    const manifestPath = path.join(
      makeArtifactDir(context, 'visual'),
      `${context.device}-manifest.json`,
    )
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    return results
  } finally {
    await client.deleteSession()
  }
}

async function runOverscrollSuite(context) {
  if (context.device !== 'ios') {
    return [
      {
        status: 'passed',
        device: context.device,
        suite: 'overscroll',
        state: 'ios-dashboard-titlebar',
        manifest: undefined,
      },
    ]
  }

  const client = await context.createClient()
  try {
    await client.switchToNativeContext()
    const results = []
    const manifest = []
    for (const route of IOS_OVERSCROLL_ROUTES) {
      results.push(
        await runCase(
          context,
          client,
          'overscroll',
          `ios-${route.state}-titlebar`,
          route.expected,
          async () => {
            if (typeof context.openUrl !== 'function') {
              throw new Error('iOS openUrl helper is unavailable')
            }
            await context.openUrl(resolveRouteUrl(context.baseUrl, route.route))
            await delay(5000)
            await client.switchToNativeContext()

            const viewport = await client.getWindowRect()
            const startX = Math.round(viewport.width / 2)
            const startY = Math.round(Math.max(48, Math.min(72, viewport.height * 0.08)))
            const endY = Math.round(Math.min(viewport.height - 80, viewport.height * 0.62))
            await client.performTouchSwipe({
              startX,
              startY,
              endX: startX,
              endY,
              durationMs: 180,
            })
            await delay(350)
            await client.performTouchSwipe({
              startX,
              startY,
              endX: startX,
              endY,
              durationMs: 180,
            })
            await delay(1500)
            const state = {
              title: `iOS overscroll ${route.state}`,
              route: route.route,
              href: resolveRouteUrl(context.baseUrl, route.route),
              bodyText: route.expected,
              fullText: route.expected,
              bodyLength: route.expected.length,
              hasErrorText: false,
              innerWidth: viewport.width,
              innerHeight: viewport.height,
              themeMode: '',
            }
            assertHealthyState(state)
            return state
          },
          manifest,
        ),
      )
    }

    const manifestPath = path.join(
      makeArtifactDir(context, 'overscroll'),
      `${context.device}-manifest.json`,
    )
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    return results
  } finally {
    await client.deleteSession()
  }
}

async function readTitleBarOverscrollState(client) {
  return client.execute(`
    const titleBar = document.querySelector('[data-testid="title-bar"], header, .MuiAppBar-root');
    const rect = titleBar?.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const bodyText = document.body.innerText || '';
    return {
      title: document.title,
      route: window.location.hash || window.location.pathname,
      href: window.location.href,
      bodyText,
      fullText: bodyText,
      bodyLength: bodyText.length,
      hasErrorText: /取得に失敗|エラー|\\bError\\b/.test(bodyText),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
      documentScrollTop: document.documentElement.scrollTop,
      bodyScrollTop: document.body.scrollTop,
      htmlClasses: document.documentElement.className,
      htmlOverflow: window.getComputedStyle(document.documentElement).overflow,
      bodyOverflow: window.getComputedStyle(document.body).overflow,
      shellTop: document.querySelector('[data-testid="app-shell"]')?.getBoundingClientRect().top ?? null,
      mainTop: document.querySelector('[data-testid="shell-main"]')?.getBoundingClientRect().top ?? null,
      titleBarTop: rect?.top ?? Number.NaN,
      titleBarBottom: rect?.bottom ?? Number.NaN,
      visualViewportTop: visualViewport?.offsetTop ?? 0,
      visualViewportHeight: visualViewport?.height ?? window.innerHeight,
      themeMode: document.querySelector('[data-theme-mode]')?.getAttribute('data-theme-mode') || ''
    };
  `)
}

async function bringWorkflowState(client, context, state) {
  if (state === 'navigation-guide') {
    await navigateAndWait(client, context.baseUrl, '#/')
    await runWorkflowAction(client, 'openNavigationDrawer')
    await runWorkflowAction(client, 'clickGuideNavigationItem')
  } else if (state === 'onair-stream-dialog') {
    await navigateAndWait(client, context.baseUrl, '#/onair')
    await runWorkflowAction(client, 'openOnAirStreamDialog')
  } else if (state === 'guide-program-dialog') {
    await navigateAndWait(client, context.baseUrl, '#/guide')
    await runWorkflowAction(client, 'openGuideProgramDialog')
  } else if (state === 'recorded-detail') {
    await navigateAndWait(client, context.baseUrl, '#/recorded')
    await runWorkflowAction(client, 'openRecordedDetail')
  } else if (state === 'recorded-streaming-dialog') {
    await navigateAndWait(client, context.baseUrl, '#/recorded')
    await runWorkflowAction(client, 'openRecordedDetail')
    await runWorkflowAction(client, 'openRecordedStreamingDialog')
  } else if (state === 'dark-dashboard') {
    await persistDarkThemeSettings(client, context.baseUrl)
    await navigateAndWait(client, context.baseUrl, '#/')
  } else if (state === 'dark-navigation-drawer-open') {
    await persistDarkThemeSettings(client, context.baseUrl)
    await navigateAndWait(client, context.baseUrl, '#/')
    await runWorkflowAction(client, 'openNavigationDrawer')
  } else {
    throw new Error(`unsupported visual state: ${state}`)
  }
}

async function runCase(context, client, suite, state, expected, action, manifest = undefined) {
  try {
    const pageState = await action()
    const screenshotPath = await saveScreenshot(context, client, suite, state)
    assertScreenshot(screenshotPath)
    const entry = buildManifestEntry(context, suite, state, expected, pageState, screenshotPath)
    if (manifest !== undefined) {
      manifest.push(entry)
    }
    console.log(`[device] PASS ${context.device}/${suite}/${state}`)
    return { status: 'passed', device: context.device, suite, state, manifest: entry }
  } catch (error) {
    return {
      status: 'failed',
      device: context.device,
      suite,
      state,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

async function navigateAndWait(client, baseUrl, route) {
  await client.navigate(resolveRouteUrl(baseUrl, route))
  await delay(3500)
  await client.switchToWebContext()
  await waitForStableBody(client)
}

function resolveRouteUrl(baseUrl, route) {
  const url = new URL(baseUrl)
  url.hash = route.replace(/^#/, '')
  return url.toString()
}

function resolveRouteUrlWithDocumentQuery(baseUrl, route, key) {
  const url = new URL(baseUrl)
  url.searchParams.set(key, String(Date.now()))
  url.hash = route.replace(/^#/, '')
  return url.toString()
}

async function waitForStableBody(client) {
  let lastLength = -1
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const state = await readPageState(client)
    if (state.bodyLength > 0 && state.bodyLength === lastLength) {
      return
    }
    lastLength = state.bodyLength
    await delay(500)
  }
}

async function readPageState(client) {
  return client.execute(`
    const bodyText = document.body.innerText || '';
    const ariaText = Array.from(document.querySelectorAll('[aria-label]'))
      .map((element) => element.getAttribute('aria-label') || '')
      .filter(Boolean)
      .join('\\n');
    return {
      title: document.title,
      route: window.location.hash || window.location.pathname,
      href: window.location.href,
      bodyText,
      ariaText,
      fullText: bodyText + '\\n' + ariaText,
      bodyLength: bodyText.length,
      hasErrorText: /取得に失敗|エラー|\\bError\\b/.test(bodyText),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      themeMode: document.querySelector('[data-theme-mode]')?.getAttribute('data-theme-mode') || ''
    };
  `)
}

async function readDarkContrastFailures(client, rootSelector) {
  return client.execute(
    `
      const rootSelector = arguments[0];
      const root = document.querySelector(rootSelector);
      if (!root) return [{ element: rootSelector, reason: 'root not found' }];
      const parseRgb = (value) => {
        const match = /^rgba?\\(([^)]+)\\)$/.exec(String(value).trim());
        if (!match) return undefined;
        const normalized = match[1].replace(/\\s*\\/\\s*/g, ', ');
        const parts = normalized.includes(',')
          ? normalized.split(',').map((part) => part.trim())
          : normalized.split(/\\s+/);
        const color = {
          r: Number(parts[0]),
          g: Number(parts[1]),
          b: Number(parts[2]),
          a: parts[3] === undefined ? 1 : Number(parts[3]),
        };
        return Object.values(color).every(Number.isFinite) ? color : undefined;
      };
      const transparent = (value) => {
        const color = parseRgb(value);
        return value === 'transparent' || color?.a === 0;
      };
      const blend = (foreground, background) => foreground.a >= 1
        ? foreground
        : {
            r: foreground.r * foreground.a + background.r * (1 - foreground.a),
            g: foreground.g * foreground.a + background.g * (1 - foreground.a),
            b: foreground.b * foreground.a + background.b * (1 - foreground.a),
            a: 1,
          };
      const linear = (value) => {
        const normalized = value / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4);
      };
      const luminance = (color) =>
        0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
      const ratio = (foregroundValue, backgroundValue) => {
        const fg = parseRgb(foregroundValue);
        const bg = parseRgb(backgroundValue);
        if (!fg || !bg || fg.a === 0) return 0;
        const effective = blend(fg, bg);
        const lighter = Math.max(luminance(effective), luminance(bg));
        const darker = Math.min(luminance(effective), luminance(bg));
        return (lighter + 0.05) / (darker + 0.05);
      };
      const backgroundOf = (element) => {
        let current = element;
        const layers = [];
        while (current) {
          const background = window.getComputedStyle(current).backgroundColor;
          if (!transparent(background)) {
            const parsed = parseRgb(background);
            if (parsed) {
              layers.push(parsed);
              if (parsed.a >= 1) {
                const base = layers[layers.length - 1];
                const effective = layers
                  .slice(0, -1)
                  .reduceRight((bg, fg) => blend(fg, bg), base);
                return 'rgb(' + Math.round(effective.r) + ', ' + Math.round(effective.g) + ', ' + Math.round(effective.b) + ')';
              }
            }
          }
          current = current.parentElement;
        }
        return window.getComputedStyle(document.body).backgroundColor;
      };
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const label = (element) =>
        element.getAttribute('data-testid') ||
        element.getAttribute('aria-label') ||
        (element.textContent || element.tagName).trim().slice(0, 80);
      const failures = [];
      const selectors = 'button,a[href],[role],svg,[class*="Icon"],[class*="icon"],[class*="navigationIcon"],span';
      for (const element of Array.from(root.querySelectorAll(selectors))) {
        if (!visible(element)) continue;
        const style = window.getComputedStyle(element);
        const background = backgroundOf(element);
        const colorRatio = ratio(style.color, background);
        if (colorRatio < 3) {
          failures.push({
            element: label(element),
            color: style.color,
            background,
            contrast: Number(colorRatio.toFixed(2)),
          });
        }
        for (const pseudo of ['::before', '::after']) {
          const pseudoStyle = window.getComputedStyle(element, pseudo);
          if (pseudoStyle.content !== 'none' && pseudoStyle.content !== 'normal' && pseudoStyle.content !== '') {
            const pseudoRatio = ratio(pseudoStyle.color, background);
            if (pseudoRatio < 3) {
              failures.push({
                element: label(element) + pseudo,
                color: pseudoStyle.color,
                background,
                contrast: Number(pseudoRatio.toFixed(2)),
              });
            }
          }
        }
      }
      return failures;
    `,
    [rootSelector],
  )
}

async function runWorkflowAction(client, step, timeoutMs = 20000) {
  const startedAt = Date.now()
  let lastReason = ''
  while (Date.now() - startedAt < timeoutMs) {
    const result = await executeWorkflowStep(client, step)
    if (result.clicked) {
      await delay(1500)
      await client.switchToWebContext()
      const state = await readPageState(client)
      if (step === 'enableDarkMode' && !state.themeMode.includes('dark')) {
        lastReason = 'theme mode did not become dark after enabling dark mode'
        await delay(700)
        continue
      }
      return state
    }
    lastReason = result.reason ?? ''
    await delay(700)
  }
  throw new Error(lastReason === '' ? `${step} target not found` : lastReason)
}

async function executeWorkflowStep(client, step) {
  return client.execute(
    `
      const step = arguments[0];
      const textOf = (el) => (el?.innerText || el?.textContent || '').trim();
      const visible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const click = (el) => {
        if (!el) return false;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        el.click();
        return true;
      };
      const byText = (pattern, selector = 'button,a,label,[role="button"],[data-testid],li,div') => {
        const regex = new RegExp(pattern);
        return Array.from(document.querySelectorAll(selector)).find((el) => visible(el) && regex.test(textOf(el)));
      };
      const firstVisible = (selectors) => {
        for (const selector of selectors) {
          const found = Array.from(document.querySelectorAll(selector)).find(visible);
          if (found) return found;
        }
        return undefined;
      };
      const pageState = (clicked, reason = '') => {
        const bodyText = document.body.innerText || '';
        const ariaText = Array.from(document.querySelectorAll('[aria-label]'))
          .map((element) => element.getAttribute('aria-label') || '')
          .filter(Boolean)
          .join('\\n');
        return {
          clicked,
          reason,
          title: document.title,
          route: window.location.hash || window.location.pathname,
          href: window.location.href,
          bodyText,
          ariaText,
          fullText: bodyText + '\\n' + ariaText,
          bodyLength: bodyText.length,
          hasErrorText: /取得に失敗|エラー|\\bError\\b/.test(bodyText),
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          themeMode: document.querySelector('[data-theme-mode]')?.getAttribute('data-theme-mode') || ''
        };
      };

      if (step === 'openNavigationDrawer') {
        const button = document.querySelector('[aria-label="ナビゲーションを開閉"], .v-app-bar__nav-icon');
        return pageState(click(button), button ? '' : 'navigation toggle not found');
      } else if (step === 'clickGuideNavigationItem') {
        const item =
          document.querySelector('[data-testid="navigation-item-guide"]') ||
          document.querySelector('[data-route-target^="/guide"]') ||
          byText('番組表', 'button,a,[role="button"],.v-navigation-drawer .v-list-item--link,.v-list-item--link');
        return pageState(click(item), item ? '' : 'guide navigation item not found');
      } else if (step === 'openOnAirStreamDialog') {
        const card = firstVisible([
          '.v-card .py-2',
          '[data-testid^="onair-card-"]:not([data-testid="onair-card-header"])',
          '[data-testid^="onair-card-body-"]',
          '[data-testid="onair-list"] article',
          '.v-card'
        ]);
        return pageState(click(card), card ? '' : 'on-air card not found');
      } else if (step === 'openGuideProgramDialog') {
        const program = firstVisible([
          '[data-testid^="guide-program-"]',
          '.guide-program-cell[data-program-id]',
          '[class*="program"][data-program-id]',
          '.programs .item'
        ]);
        return pageState(click(program), program ? '' : 'guide program not found');
      } else if (step === 'openRecordedDetail') {
        const item = firstVisible([
          '[data-testid="recorded-list-item"]',
          '.recorded-small-card',
          '.recorded-large-card',
          'tbody tr',
          'article[data-testid="recorded-list-item"]',
          '.v-list-item'
        ]);
        return pageState(click(item), item ? '' : 'recorded item not found');
      } else if (step === 'openRecordedStreamingDialog') {
        const button =
          document.querySelector('[data-recorded-detail-action="streaming"]') ||
          byText('streaming|Streaming|STREAMING|ストリーミング|ストリーム', 'button,a,[role="button"],.v-btn');
        return pageState(click(button), button ? '' : 'recorded streaming button not found');
      } else if (step === 'enableDarkMode') {
        const root = document.querySelector('[data-theme-mode]');
        if (root?.getAttribute('data-theme-mode') !== 'dark') {
          const switches = Array.from(
            document.querySelectorAll('input[role="switch"],input[type="checkbox"],[role="switch"]'),
          ).filter(visible);
          const findSwitch = (label, fallbackIndex) =>
            switches.find(
              (el) => {
                if (!visible(el)) return false;
                const ariaLabel = el.getAttribute('aria-label') || '';
                const labelText = textOf(el.closest('label'));
                return ariaLabel === label || labelText.includes(label.replace(/^全般 /, ''));
              },
            ) || switches[fallbackIndex];
          const setSwitch = (control, checked) => {
            if (!control) return false;
            if (control.disabled === true || control.getAttribute('aria-disabled') === 'true') {
              return false;
            }
            if (control.checked === checked) {
              return true;
            }
            return click(control);
          };
          const osColorControl = findSwitch('全般 OSカラーテーマ', 1);
          const darkControl = findSwitch('全般 ダークテーマ', 2);
          const switchSummary = () =>
            Array.from(document.querySelectorAll('input[role="switch"],input[type="checkbox"],[role="switch"]'))
              .filter(visible)
              .map((el) => ({
                label: el.getAttribute('aria-label') || '',
                text: textOf(el.closest('label')).slice(0, 80),
                checked: Boolean(el.checked),
                disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
                tag: el.tagName,
                role: el.getAttribute('role') || '',
              }))
              .slice(0, 12);
          if (osColorControl?.checked === true) {
            return pageState(
              setSwitch(osColorControl, false),
              'OS color theme control was not operable: ' + JSON.stringify(switchSummary()),
            );
          }
          const darkReady = setSwitch(darkControl, true);
          if (!darkReady) {
            return pageState(
              false,
              'dark mode controls were not operable: ' + JSON.stringify(switchSummary()),
            );
          }
          return pageState(true);
        }
        return pageState(true);
      } else {
        throw new Error('unsupported workflow step');
      }
    `,
    [step],
  )
}

function assertIncludes(actual, expected, label) {
  if (!String(actual).includes(expected)) {
    throw new Error(`${label} did not include expected text`)
  }
}

function assertIncludesAny(actual, expectedValues, label) {
  if (!expectedValues.some((expected) => String(actual).includes(expected))) {
    throw new Error(`${label} did not include any expected text`)
  }
}

function assertHealthyState(state) {
  if (state.hasErrorText || ERROR_PATTERN.test(state.bodyText ?? '')) {
    throw new Error('page contains error text')
  }
  if (!Number.isFinite(state.innerWidth) || !Number.isFinite(state.innerHeight)) {
    throw new Error('viewport dimensions are unavailable')
  }
  if (state.innerWidth <= 0 || state.innerHeight <= 0) {
    throw new Error('viewport dimensions are zero')
  }
}

async function saveScreenshot(context, client, suite, state) {
  const artifactDir = makeArtifactDir(context, suite)
  const filePath = path.join(artifactDir, `${context.device}-${state}.png`)
  const screenshot = await client.screenshot()
  writeFileSync(filePath, Buffer.from(screenshot, 'base64'))
  return filePath
}

function makeArtifactDir(context, suite) {
  const dir = path.join(context.artifactRoot, suite)
  mkdirSync(dir, { recursive: true })
  return dir
}

function assertScreenshot(filePath) {
  const stats = statSync(filePath)
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error('screenshot file was not generated')
  }
}

function buildManifestEntry(context, suite, state, expected, pageState, screenshotPath) {
  return {
    device: context.device,
    suite,
    state,
    expected,
    title: pageState.title,
    route: pageState.route,
    href: redactHref(pageState.href),
    viewport: {
      width: pageState.innerWidth,
      height: pageState.innerHeight,
    },
    themeMode: pageState.themeMode,
    timestamp: new Date().toISOString(),
    screenshotPath: path.relative(context.repoRoot, screenshotPath),
  }
}

function redactHref(href) {
  try {
    const url = new URL(href)
    const hash = url.hash.split('?')[0]
    return `<redacted-origin>${url.pathname}${hash}`
  } catch {
    return '<redacted-href>'
  }
}

function printSuiteSummary(device, suite, results) {
  const passed = results.filter((result) => result.status === 'passed').length
  const failed = results.length - passed
  console.log(`[device] summary ${device}/${suite}: ${passed} passed, ${failed} failed`)
}

async function waitForAppium(appiumUrl) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 60000) {
    try {
      const response = await fetch(new URL('/status', appiumUrl))
      if (response.ok) {
        return
      }
    } catch {
      // Wait until the server accepts connections.
    }
    await delay(1000)
  }
  throw new Error('Appium server did not become ready')
}

class AppiumClient {
  constructor(appiumUrl) {
    this.appiumUrl = appiumUrl
    this.sessionId = undefined
  }

  async createSession(capabilities) {
    const response = await this.request('POST', '/session', capabilities)
    this.sessionId = response.value?.sessionId ?? response.sessionId
    if (this.sessionId === undefined) {
      throw new Error('Appium session id was not returned')
    }
  }

  async deleteSession() {
    if (this.sessionId === undefined) return
    try {
      await this.request('DELETE', `/session/${this.sessionId}`)
    } finally {
      this.sessionId = undefined
    }
  }

  async navigate(url) {
    await this.request('POST', `/session/${this.requireSession()}/url`, { url })
  }

  async switchToWebContext(expectedHrefPrefix = undefined) {
    const contexts = await this.request('GET', `/session/${this.requireSession()}/contexts`)
    const names = Array.isArray(contexts.value) ? contexts.value : []
    const webContexts = names.filter((name) => name === 'CHROMIUM' || name.startsWith('WEBVIEW'))
    if (webContexts.length === 0) {
      return
    }

    if (expectedHrefPrefix !== undefined) {
      const expectedUrl = new URL(expectedHrefPrefix)
      for (const webContext of webContexts) {
        await this.request('POST', `/session/${this.requireSession()}/context`, {
          name: webContext,
        })
        try {
          const response = await this.request(
            'POST',
            `/session/${this.requireSession()}/execute/sync`,
            {
              script: 'return window.location.href',
              args: [],
            },
          )
          const href = String(response.value ?? '')
          if (href.startsWith(expectedUrl.origin)) {
            return
          }
        } catch {
          // Try the next web context.
        }
      }
    }

    if (webContexts[0] !== undefined) {
      await this.request('POST', `/session/${this.requireSession()}/context`, {
        name: webContexts[0],
      })
    }
  }

  async switchToNativeContext() {
    await this.request('POST', `/session/${this.requireSession()}/context`, { name: 'NATIVE_APP' })
  }

  async getWindowRect() {
    const response = await this.request('GET', `/session/${this.requireSession()}/window/rect`)
    return response.value
  }

  async execute(script, args = []) {
    const response = await this.request('POST', `/session/${this.requireSession()}/execute/sync`, {
      script,
      args,
    })
    return response.value
  }

  async screenshot() {
    const response = await this.request('GET', `/session/${this.requireSession()}/screenshot`)
    return response.value
  }

  async performTouchSwipe({ startX, startY, endX, endY, durationMs }) {
    await this.request('POST', `/session/${this.requireSession()}/actions`, {
      actions: [
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: startX, y: startY },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 50 },
            { type: 'pointerMove', duration: durationMs, x: endX, y: endY },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    })
    await this.request('DELETE', `/session/${this.requireSession()}/actions`)
  }

  async request(method, route, body = undefined) {
    const response = await fetch(new URL(route, this.appiumUrl), {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = payload.value?.message ?? payload.message ?? `${method} ${route} failed`
      throw new Error(sanitizeMessage(message))
    }
    return payload
  }

  requireSession() {
    if (this.sessionId === undefined) {
      throw new Error('Appium session has not been created')
    }
    return this.sessionId
  }
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30000,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} failed: ${sanitizeMessage(output)}`)
  }
  return output
}

function runSsh(host, command, options = {}) {
  return runCommand('ssh', [host, command], { timeoutMs: options.timeoutMs ?? 30000 })
}

function spawnManagedProcess(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: 'ignore',
    detached: false,
  })
  child.on('error', (error) => {
    console.error(`[device] ${label} process error: ${sanitizeMessage(error.message)}`)
  })
  return child
}

async function stopManagedProcess(child) {
  if (child === undefined || child.killed || child.exitCode !== null) {
    return
  }
  child.kill('SIGTERM')
  const stopped = await waitForProcessExit(child, 5000)
  if (!stopped && !child.killed) {
    child.kill('SIGKILL')
    await waitForProcessExit(child, 3000)
  }
}

function waitForProcessExit(child, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}

function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function sanitizeMessage(message) {
  return String(message)
    .replace(/https?:\/\/[^\s"'<>]+/g, '<redacted-url>')
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, '<redacted-path>')
    .replace(/\/(?:Users|home|tmp|private|var)\/[^\s"'<>]+/g, '<redacted-path>')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '<redacted-user-host>')
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main()
