import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface ChildResult {
    readonly code: number | null;
    readonly events: string[];
    readonly resources: {
        readonly child: {
            readonly closeEvents: number;
            readonly closeListeners: number;
            readonly errorListeners: number;
        };
        readonly databaseHandle: {
            readonly connectionCloseEnds: number;
            readonly connectionCloseStarts: number;
            readonly opened: number;
            readonly released: number;
        };
        readonly pipes: {
            readonly stderr: { readonly dataListeners: number; readonly destroyed: boolean };
            readonly stdout: { readonly dataListeners: number; readonly destroyed: boolean };
        };
        readonly temporaryDirectory: {
            readonly created: number;
            readonly exists: boolean;
            readonly removed: number;
        };
    };
    readonly signal: NodeJS.Signals | null;
    readonly stderr: string;
    readonly terminatedAfterObservation: boolean;
    readonly timedOut: boolean;
}

interface RunOptions {
    readonly hardDeadlineMs?: number;
    readonly snapshot?: string;
    readonly terminateAfterEvent?: string;
}

const successEvents: Record<string, string[]> = {
    'backup-success': [
        'container:set',
        'logger:init',
        'log:--- run ---',
        'db:check',
        'db:ready',
        'log:--- start backup ---',
        'log:rule',
        'read:rule',
        'log:reserve',
        'read:reserve',
        'log:drop log file',
        'read:drop-log',
        'log:recorded',
        'read:recorded:relations-disabled',
        'log:thumbnail file',
        'read:thumbnail',
        'log:video file',
        'read:video-file',
        'log:recorded history',
        'read:recorded-history',
        'log:recorded tag',
        'read:recorded-tag',
        'log:--- writing ---',
        'file:write:versionless-root',
        'file:write:config-absent',
        'db:close:start',
        'db:close:end',
        'log:--- finish ---',
        'process:exit:0',
    ],
    'restore-success': [
        'container:set',
        'logger:init',
        'log:--- run ---',
        'db:check',
        'db:ready',
        'log:--- start restore ---',
        'log:--- read backup file ---',
        'file:read',
        'log:--- restore ---',
        'log:rule',
        'restore:rule',
        'restore:rule:items-1',
        'log:reserve',
        'restore:reserve',
        'restore:reserve:items-1',
        'log:drop log file',
        'restore:drop-log',
        'restore:drop-log:items-1',
        'log:recorded',
        'restore:recorded',
        'restore:recorded:items-1',
        'log:thumbnail file',
        'restore:thumbnail',
        'restore:thumbnail:items-1',
        'log:video file',
        'restore:video-file',
        'restore:video-file:items-1',
        'log:recorded history',
        'restore:recorded-history',
        'restore:recorded-history:items-1',
        'log:recorded tag',
        'restore:recorded-tag',
        'restore:recorded-tag:items-1',
        'db:close:start',
        'db:close:end',
        'log:--- finish ---',
        'process:exit:0',
    ],
    'v1-success': [
        'container:set',
        'logger:init',
        'log:--- run ---',
        'log:--- read old backup file ---',
        'file:read',
        'file:read:v1-final-schema',
        'db:check',
        'db:ready',
        'log:--- import rules ---',
        'insert:rule',
        'insert:rule:old-id-1:new-id-71',
        'log:--- import recorded ---',
        'insert:recorded',
        'insert:recorded:rule-id-mapped-71',
        'insert:recorded:state-false',
        'insert:recorded:excluded-fields-absent',
        'insert:thumbnail',
        'insert:thumbnail:recorded-id-mapped-81',
        'insert:video-file',
        'insert:video-file:original-recorded-id-mapped-81',
        'log:--- import encode video files ---',
        'insert:video-file',
        'insert:video-file:encoded-recorded-id-mapped-81',
        'log:--- import recorded history ---',
        'insert:recorded-history',
        'insert:recorded-history:name-channel-endat',
        'db:close:start',
        'db:close:end',
        'log:--- finish ---',
        'process:exit:0',
    ],
};

type TraceOutcome = 'success' | 'failure' | 'pending';

interface TraceRow {
    readonly id: string;
    readonly outcome: TraceOutcome;
    readonly scenario?: string;
    readonly expected?: readonly string[];
    readonly absent?: readonly string[];
    readonly stderr?: string;
}

const traceRows: readonly TraceRow[] = [
    {
        id: 'MT-1.1',
        outcome: 'success',
        scenario: 'backup-success',
        expected: ['log:--- start backup ---', 'file:write:versionless-root'],
    },
    {
        id: 'MT-1.2',
        outcome: 'success',
        scenario: 'restore-success',
        expected: ['log:--- start restore ---', 'restore:recorded-tag'],
    },
    {
        id: 'MT-1.3',
        outcome: 'success',
        scenario: 'v1-success',
        expected: ['log:--- read old backup file ---', 'insert:recorded-history'],
    },
    {
        id: 'MT-1.4',
        outcome: 'failure',
        scenario: 'db-invalid-missing',
        stderr: '引数が足りません',
        expected: ['process:exit:1'],
        absent: ['logger:init', 'file:read', 'db:check'],
    },
    {
        id: 'MT-1.5',
        outcome: 'failure',
        scenario: 'db-invalid-mode',
        stderr: 'mode の指定が間違っています',
        expected: ['process:exit:1'],
        absent: ['logger:init', 'file:read', 'db:check'],
    },
    {
        id: 'MT-2.1',
        outcome: 'success',
        scenario: 'backup-success',
        expected: [
            'read:rule',
            'read:reserve',
            'read:drop-log',
            'read:recorded:relations-disabled',
            'read:thumbnail',
            'read:video-file',
            'read:recorded-history',
            'read:recorded-tag',
        ],
    },
    {
        id: 'MT-2.2',
        outcome: 'success',
        scenario: 'backup-success',
        expected: ['log:--- writing ---', 'file:write:versionless-root'],
    },
    {
        id: 'MT-2.3',
        outcome: 'success',
        scenario: 'backup-success',
        expected: ['read:recorded:relations-disabled', 'read:recorded-tag'],
    },
    {
        id: 'MT-2.4',
        outcome: 'success',
        scenario: 'backup-success',
        absent: ['media:copy', 'media:move', 'media:remove'],
    },
    { id: 'MT-2.5', outcome: 'success', scenario: 'backup-success', expected: ['file:write:config-absent'] },
    {
        id: 'MT-3.1',
        outcome: 'success',
        scenario: 'restore-success',
        expected: ['db:ready', 'file:read', 'log:--- restore ---'],
    },
    {
        id: 'MT-3.2',
        outcome: 'failure',
        scenario: 'restore-parse-reject',
        expected: ['file:read'],
        absent: ['restore:rule'],
    },
    { id: 'MT-3.3', outcome: 'success', scenario: 'restore-success', expected: ['restore:rule:items-1'] },
    {
        id: 'MT-3.4',
        outcome: 'success',
        scenario: 'restore-success',
        absent: ['media:copy', 'media:move', 'media:remove'],
    },
    {
        id: 'MT-3.5',
        outcome: 'success',
        scenario: 'restore-success',
        expected: ['restore:recorded-tag:items-1'],
        absent: ['restore:recorded-tag-relation'],
    },
    {
        id: 'MT-3.6',
        outcome: 'success',
        scenario: 'restore-success',
        expected: [
            'restore:rule',
            'restore:reserve',
            'restore:drop-log',
            'restore:recorded',
            'restore:thumbnail',
            'restore:video-file',
            'restore:recorded-history',
            'restore:recorded-tag',
        ],
    },
    {
        id: 'MT-3.7',
        outcome: 'failure',
        scenario: 'restore-stage-reject',
        expected: ['restore:drop-log'],
        absent: ['log:recorded'],
    },
    { id: 'MT-4.1', outcome: 'success', scenario: 'v1-success', expected: ['file:read:v1-final-schema'] },
    { id: 'MT-4.2', outcome: 'success', scenario: 'v1-success', expected: ['file:read', 'db:check'] },
    {
        id: 'MT-4.3',
        outcome: 'failure',
        scenario: 'v1-parse-reject',
        expected: ['file:read', 'error:file parse error'],
        absent: ['db:check', 'insert:rule'],
    },
    {
        id: 'MT-4.4',
        outcome: 'success',
        scenario: 'v1-success',
        expected: ['insert:rule:old-id-1:new-id-71', 'insert:recorded:rule-id-mapped-71'],
    },
    { id: 'MT-4.5', outcome: 'success', scenario: 'v1-success', expected: ['insert:recorded:rule-id-mapped-71'] },
    {
        id: 'MT-4.6',
        outcome: 'success',
        scenario: 'v1-success',
        expected: [
            'insert:thumbnail:recorded-id-mapped-81',
            'insert:video-file:original-recorded-id-mapped-81',
            'insert:video-file:encoded-recorded-id-mapped-81',
        ],
    },
    {
        id: 'MT-4.7',
        outcome: 'success',
        scenario: 'v1-success',
        expected: ['insert:recorded-history:name-channel-endat'],
    },
    { id: 'MT-4.8', outcome: 'success', scenario: 'v1-success', absent: ['insert:reserve', 'insert:drop-log'] },
    { id: 'MT-4.9', outcome: 'success', scenario: 'v1-success', expected: ['insert:recorded:state-false'] },
    { id: 'MT-4.10', outcome: 'success', scenario: 'v1-success', expected: ['insert:recorded:excluded-fields-absent'] },
    { id: 'MT-4.11', outcome: 'success', scenario: 'v1-success', absent: ['media:copy', 'media:move', 'media:remove'] },
    {
        id: 'MT-4.12',
        outcome: 'success',
        scenario: 'v1-success',
        expected: [
            'log:--- import rules ---',
            'log:--- import recorded ---',
            'log:--- import encode video files ---',
            'log:--- import recorded history ---',
        ],
    },
    {
        id: 'MT-4.13',
        outcome: 'failure',
        scenario: 'v1-stage-reject',
        expected: ['insert:rule'],
        absent: ['log:--- import recorded ---'],
    },
    {
        id: 'MT-5.1',
        outcome: 'success',
        scenario: 'backup-success',
        expected: ['db:check', 'log:--- start backup ---'],
    },
    {
        id: 'MT-5.3',
        outcome: 'pending',
        scenario: 'backup-db-pending',
        expected: ['db:check'],
        absent: ['log:--- start backup ---'],
    },
    {
        id: 'MT-5.4',
        outcome: 'success',
        scenario: 'backup-success',
        expected: [
            'log:rule',
            'log:reserve',
            'log:drop log file',
            'log:recorded',
            'log:thumbnail file',
            'log:video file',
            'log:recorded history',
            'log:recorded tag',
        ],
    },
    {
        id: 'MT-5.5',
        outcome: 'success',
        scenario: 'backup-success',
        expected: ['db:close:end', 'log:--- finish ---', 'process:exit:0'],
    },
    {
        id: 'MT-5.6',
        outcome: 'failure',
        scenario: 'backup-close-reject',
        expected: ['db:close:start'],
        absent: ['log:--- finish ---', 'process:exit:0'],
    },
];

// The compiled entrypoints (`DBTools.js`/`V1MigrationTool.js`) are ES modules: their static
// `import container from './model/ModelContainer.js'` / `import * as fs from 'fs'` bindings never
// go through CommonJS's `Module._load`, so a spawned `.cjs` wrapper that `require()`s the compiled
// entry cannot see -- let alone replace -- those
// imports; the real, unstubbed dependencies load instead (confirmed: every scenario below then runs
// against a genuine, unconfigured `ModelContainer` and exits 1). Node's own mechanism for
// intercepting another module's imports is a registered loader hook
// (`../harness/child-module-overrides.mjs`, shared with other already-migrated suites): a small
// generated wrapper script, spawned as the child's actual main module, registers it with
// per-scenario replacement sources keyed to the entry file's own resolved URL and then dynamically
// imports the real compiled entry and invokes it explicitly (see `preloadSource` below for why this
// wrapper -- not the entry -- has to be the process's main module).
//
// `reflect-metadata` and `source-map-support` are left unreplaced -- the entry's own real,
// unmodified imports of those packages behave the same way they did before the ESM migration, and
// only the two dependency-injection seams (`./model/ModelContainer.js`,
// `./model/ModelContainerSetter.js`) plus the entry's own `fs` usage need synthetic replacements.
const backup = {
    ruleItems: [{ id: 1 }],
    reserveItems: [{ id: 2 }],
    recordedItems: [{ id: 3 }],
    thumbnailItems: [{ id: 4 }],
    videoFileItems: [{ id: 5 }],
    dropLogFileItems: [{ id: 6 }],
    recordedHistoryItems: [{ id: 7 }],
    recordedTagItems: [{ id: 8 }],
};
const v1Rule = {
    id: 1,
    keyword: null,
    ignoreKeyword: null,
    keyCS: null,
    keyRegExp: null,
    title: null,
    description: null,
    extended: null,
    ignoreKeyCS: null,
    ignoreKeyRegExp: null,
    ignoreTitle: null,
    ignoreDescription: null,
    ignoreExtended: null,
    GR: null,
    BS: null,
    CS: null,
    SKY: null,
    station: null,
    genrelv1: null,
    genrelv2: null,
    startTime: null,
    timeRange: null,
    week: 1,
    isFree: null,
    durationMin: null,
    durationMax: null,
    enable: true,
    allowEndLack: false,
    avoidDuplicate: false,
    periodToAvoidDuplicate: null,
    directory: null,
    recordedFormat: null,
    mode1: null,
    mode2: null,
    mode3: null,
    directory1: null,
    directory2: null,
    directory3: null,
    delTs: null,
};
const oldRecorded = {
    id: 10,
    ruleId: 1,
    programId: null,
    channelId: 2,
    startAt: 10,
    endAt: 20,
    duration: 10,
    name: 'synthetic-recorded',
    description: 'synthetic-description',
    extended: 'ＡＢ',
    genre1: 1,
    genre2: 2,
    genre3: null,
    genre4: null,
    genre5: null,
    genre6: null,
    videoType: null,
    videoResolution: null,
    videoStreamContent: null,
    videoComponentType: null,
    audioSamplingRate: 48_000,
    audioComponentType: null,
    recPath: 'synthetic-media.ts',
    thumbnailPath: 'synthetic-thumbnail.jpg',
    recording: true,
    protection: true,
    filesize: null,
    logPath: 'synthetic-excluded.log',
    errorCnt: 1,
    dropCnt: 2,
    scramblingCnt: 3,
    isTmp: true,
};
const oldBackup = {
    rules: [v1Rule],
    recorded: [oldRecorded],
    encoded: [{ recordedId: 10, path: 'synthetic-encoded.mp4', name: 'synthetic-encoded', filesize: 7 }],
    recordedHistory: [{ name: 'synthetic-history', channelId: 2, endAt: 20 }],
    dbRevisionInfo: { revision: 1 },
};

const harnessDirectory = fileURLToPath(new URL('../harness/', import.meta.url));
const overridesLoaderUrl = pathToFileURL(join(harnessDirectory, 'child-module-overrides.mjs')).href;

const entryFileName = (scenario: string): string => (scenario.startsWith('v1-') ? 'V1MigrationTool.js' : 'DBTools.js');

const buildCliArgs = (scenario: string): string[] => {
    if (scenario.startsWith('v1-')) return scenario === 'v1-invalid' ? [] : ['-i', 'synthetic-v1-input'];
    if (scenario === 'db-invalid-missing') return [];
    if (scenario === 'db-invalid-mode') return ['-m', 'unknown', '-o', 'synthetic-path'];
    return ['-m', scenario.startsWith('restore-') ? 'restore' : 'backup', '-o', 'synthetic-path'];
};

// Generates the child's actual main script for one scenario: a small wrapper, spawned directly as
// `node wrapperPath`, that registers the loader-hook replacements and then dynamically imports the
// real compiled entry and invokes it explicitly.
//
// The entry's own top-level self-start guard (`resolve(process.argv[1]) === fileURLToPath(import
// .meta.url)`) is written for genuine direct invocation (`node dist/DBTools.js ...`); with this file
// -- not the entry -- as the process's main module, that guard is never true, so (mirroring the
// pre-migration `.cjs` fixture's own "not the process's main module" comment) this wrapper always
// calls `new EntryClass().run()` explicitly instead of relying on it. That also sidesteps a real
// symlink hazard: Node's ESM loader realpath's every module it loads except the literal main module
// (`--preserve-symlinks-main` can keep the *main* module's given, unresolved identity, but that then
// makes bare-specifier package resolution -- e.g. `minimist` -- search from that given, possibly
// symlink-external location instead of the real one, breaking it). Dynamically importing the entry
// from this wrapper keeps the entry a *non*-main module, so it is realpath'd like any other import:
// package resolution stays anchored to its real on-disk location regardless of a symlinked
// `EPGSTATION_SERVER_COMPILED_SNAPSHOT`, and this wrapper computes the exact same realpath itself
// (`realpathSync(entryPath)`) to key the loader-hook replacements to the identity Node will actually
// report as `context.parentURL` for the entry's own `./model/ModelContainer.js` / `fs` imports --
// exactly like the pre-migration `Module._load` hook keyed on `require.resolve(entryPath)` rather
// than the as-given path for the same reason.
const preloadSource = (scenario: string, entryPath: string): string => {
    const isV1 = scenario.startsWith('v1-');
    const cliArgs = buildCliArgs(scenario);
    return [
        "import { join } from 'node:path';",
        "import { closeSync, openSync, realpathSync } from 'node:fs';",
        "import { pathToFileURL } from 'node:url';",
        '',
        `const scenario = ${JSON.stringify(scenario)};`,
        `const isV1 = ${JSON.stringify(isV1)};`,
        "const event = value => process.stdout.write(value + '\\n');",
        'const never = new Promise(() => undefined);',
        '',
        "if (scenario === 'backup-db-pending') {",
        "    const handle = openSync(join(process.cwd(), 'pending-db-handle'), 'w');",
        "    event('db:handle:opened');",
        "    process.once('SIGTERM', () => {",
        '        closeSync(handle);',
        "        event('db:handle:released');",
        "        process.kill(process.pid, 'SIGTERM');",
        '    });',
        '}',
        "if (scenario.includes('-pending')) setInterval(() => undefined, 60_000);",
        "if (scenario === 'backup-db-pending-ignore-sigterm') {",
        "    process.on('SIGTERM', () => event('signal:SIGTERM'));",
        '}',
        '',
        `const backup = ${JSON.stringify(backup)};`,
        `const oldBackup = ${JSON.stringify(oldBackup)};`,
        '',
        'const collection = (name, value) => ({',
        '    findAll: async (...args) => {',
        '        const recordedOptions = args[1];',
        '        const relationsAreDisabled =',
        "            name === 'recorded' &&",
        '            recordedOptions !== null &&',
        "            typeof recordedOptions === 'object' &&",
        '            recordedOptions.isNeedVideoFiles === false &&',
        '            recordedOptions.isNeedThumbnails === false &&',
        '            recordedOptions.isNeedsDropLog === false &&',
        '            recordedOptions.isNeedTags === false;',
        "        event(relationsAreDisabled ? 'read:recorded:relations-disabled' : 'read:' + name);",
        "        if (scenario === 'backup-stage-reject' && name === 'reserve') {",
        "            throw new Error('synthetic backup stage rejection');",
        '        }',
        '        return value;',
        '    },',
        '    restore: async items => {',
        "        event('restore:' + name);",
        "        event('restore:' + name + ':items-' + (Array.isArray(items) ? items.length : 'invalid'));",
        "        if (scenario === 'restore-stage-reject' && name === 'drop-log') {",
        "            throw new Error('synthetic restore stage rejection');",
        '        }',
        '    },',
        '    insertOnce: async value => {',
        "        if (name === 'rule') {",
        "            event('insert:rule');",
        "            event('insert:rule:old-id-1:new-id-71');",
        "        } else if (name === 'recorded') {",
        '            const hasNoExcludedFields = [',
        "                'audioSamplingRate',",
        "                'dropCnt',",
        "                'errorCnt',",
        "                'isTmp',",
        "                'logPath',",
        "                'scramblingCnt',",
        '            ].every(key => !Object.hasOwn(value, key));',
        '            const isManualUnprotected =',
        '                value.programId === null && value.isProtected === false && value.isRecording === false;',
        '            const hasMappedRuleId = value.ruleId === 71;',
        "            event('insert:recorded');",
        "            if (hasMappedRuleId) event('insert:recorded:rule-id-mapped-71');",
        "            if (isManualUnprotected) event('insert:recorded:state-false');",
        "            if (hasNoExcludedFields) event('insert:recorded:excluded-fields-absent');",
        '            if (!(hasMappedRuleId && isManualUnprotected && hasNoExcludedFields)) {',
        "                event('insert:recorded:unexpected-data');",
        '            }',
        "        } else if (name === 'thumbnail') {",
        "            event('insert:thumbnail');",
        "            if (value.recordedId === 81) event('insert:thumbnail:recorded-id-mapped-81');",
        "        } else if (name === 'video-file') {",
        "            event('insert:video-file');",
        "            if (value.recordedId === 81 && value.type === 'ts' && value.name === 'ts') {",
        "                event('insert:video-file:original-recorded-id-mapped-81');",
        '            }',
        "            if (value.recordedId === 81 && value.type === 'encoded' && value.name === 'synthetic-encoded') {",
        "                event('insert:video-file:encoded-recorded-id-mapped-81');",
        '            }',
        "        } else if (name === 'recorded-history') {",
        "            event('insert:recorded-history');",
        "            if (value.name === 'synthetic-history' && value.channelId === 2 && value.endAt === 20) {",
        "                event('insert:recorded-history:name-channel-endat');",
        '            }',
        '        } else {',
        "            event('insert:' + name);",
        '        }',
        "        if (scenario === 'v1-stage-reject' && name === 'rule') {",
        "            throw new Error('synthetic v1 stage rejection');",
        '        }',
        "        if (name === 'rule') return 71;",
        "        if (name === 'recorded') return 81;",
        '        return 1;',
        '    },',
        '});',
        '',
        'const dependencies = {',
        '    ILoggerModel: {',
        "        initialize: () => event('logger:init'),",
        '        getLogger: () => ({',
        '            system: {',
        "                error: value => event('error:' + String(value)),",
        "                info: value => event('log:' + String(value)),",
        '            },',
        '        }),',
        '    },',
        "    IConfiguration: { getConfig: () => ({ recorded: [{ name: 'synthetic-root' }], encode: [] }) },",
        '    IConnectionCheckModel: {',
        '        checkDB: async () => {',
        "            event('db:check');",
        "            if (scenario === 'backup-db-pending' || scenario === 'backup-db-pending-ignore-sigterm') await never;",
        "            event('db:ready');",
        '        },',
        '    },',
        '    IDBOperator: {',
        '        closeConnection: async () => {',
        "            event('db:close:start');",
        "            if (scenario === 'backup-close-pending') await never;",
        "            if (scenario.endsWith('-close-reject')) throw new Error('synthetic close rejection');",
        "            event('db:close:end');",
        '        },',
        '    },',
        "    IRuleDB: collection('rule', [backup.ruleItems, 1]),",
        "    IReserveDB: collection('reserve', [backup.reserveItems, 1]),",
        "    IDropLogFileDB: collection('drop-log', backup.dropLogFileItems),",
        "    IRecordedDB: collection('recorded', [backup.recordedItems, 1]),",
        "    IThumbnailDB: collection('thumbnail', backup.thumbnailItems),",
        "    IVideoFileDB: collection('video-file', backup.videoFileItems),",
        "    IRecordedHistoryDB: collection('recorded-history', backup.recordedHistoryItems),",
        "    IRecordedTagDB: collection('recorded-tag', [backup.recordedTagItems, 1]),",
        '};',
        'const container = { get: name => dependencies[name] };',
        '',
        'const filesystem = {',
        '    readFileSync: () => {',
        "        event('file:read');",
        "        if (scenario === 'restore-parse-reject' || scenario === 'v1-parse-reject') {",
        "            return '{';",
        '        }',
        "        if (isV1) event('file:read:v1-final-schema');",
        '        return JSON.stringify(isV1 ? oldBackup : backup);',
        '    },',
        '    writeFileSync: (_path, contents) => {',
        '        const backupRoot = JSON.parse(contents);',
        '        const isVersionlessRoot =',
        '            JSON.stringify(Object.keys(backupRoot).sort()) ===',
        '            JSON.stringify(',
        '                [',
        "                    'dropLogFileItems',",
        "                    'recordedHistoryItems',",
        "                    'recordedItems',",
        "                    'recordedTagItems',",
        "                    'reserveItems',",
        "                    'ruleItems',",
        "                    'thumbnailItems',",
        "                    'videoFileItems',",
        '                ].sort(),',
        '            );',
        "        event(isVersionlessRoot ? 'file:write:versionless-root' : 'file:write:unexpected-root');",
        "        if (isVersionlessRoot) event('file:write:config-absent');",
        '    },',
        '};',
        '',
        'globalThis.__epgstationManagementOverrides = {',
        '    container,',
        '    filesystem,',
        "    onContainerSet: () => event('container:set'),",
        '};',
        '',
        "const containerSource = 'export default globalThis.__epgstationManagementOverrides.container;';",
        "const setterSource = 'export const set = () => globalThis.__epgstationManagementOverrides.onContainerSet();';",
        'const fsSource = [',
        "    'const overrides = globalThis.__epgstationManagementOverrides;',",
        "    'export const readFileSync = (...args) => overrides.filesystem.readFileSync(...args);',",
        "    'export const writeFileSync = (...args) => overrides.filesystem.writeFileSync(...args);',",
        "    'export default { readFileSync, writeFileSync };',",
        "].join('\\n');",
        '',
        `const entryPath = ${JSON.stringify(entryPath)};`,
        'const entryUrl = pathToFileURL(realpathSync(entryPath)).href;',
        `const { registerOverrides } = await import(${JSON.stringify(overridesLoaderUrl)});`,
        'registerOverrides([',
        "    { specifier: './model/ModelContainer.js', parentURL: entryUrl, source: containerSource },",
        "    { specifier: './model/ModelContainerSetter.js', parentURL: entryUrl, source: setterSource },",
        "    { specifier: 'fs', parentURL: entryUrl, source: fsSource },",
        ']);',
        '',
        'const originalExit = process.exit.bind(process);',
        'process.exit = code => {',
        "    event('process:exit:' + (code ?? 0));",
        '    return originalExit(code ?? 0);',
        '};',
        '',
        // `argv[1]` is deliberately left as this wrapper's own path (never `entryPath`): the entry's
        // self-start guard compares `resolve(process.argv[1])` against its own `import.meta.url`, and
        // setting `argv[1]` to `entryPath` would make that guard true too, invoking the entry a
        // second time (observed: interleaved, duplicated event traces) on top of the explicit
        // `new EntryClass().run()` below. minimist only reads `process.argv.slice(2)`, so only that
        // tail needs to carry the scenario's CLI arguments.
        `process.argv = [process.argv[0], process.argv[1], ${cliArgs.map(argument => JSON.stringify(argument)).join(', ')}];`,
        '',
        '// This wrapper -- not the entry -- is the process main module, so the entry\'s own',
        '// `resolve(process.argv[1]) === fileURLToPath(import.meta.url)` self-start guard is never true;',
        '// the unconditional `new EntryClass().run()` below is done explicitly instead (see the file',
        '// header comment).',
        'const EntryClass = (await import(pathToFileURL(entryPath).href)).default;',
        'new EntryClass().run();',
        '',
    ].join('\n');
};

const expectEventsInOrder = (events: readonly string[], expected: readonly string[]) => {
    let nextIndex = 0;
    for (const event of expected) {
        const index = events.indexOf(event, nextIndex);
        expect(index, `expected event ${event}`).toBeGreaterThanOrEqual(nextIndex);
        nextIndex = index + 1;
    }
};
const expectEventsAbsent = (events: readonly string[], absent: readonly string[]) => {
    for (const event of absent) expect(events).not.toContain(event);
};
const run = (scenario: string, options: number | RunOptions = 2_000): Promise<ChildResult> =>
    new Promise((resolve, reject) => {
        const { hardDeadlineMs, snapshot, terminateAfterEvent } =
            typeof options === 'number' ? { hardDeadlineMs: options } : options;
        const temporaryDirectory = mkdtempSync(join(tmpdir(), 'epgstation-management-cli-'));
        const compiledSnapshot = snapshot ?? process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
        if (compiledSnapshot === undefined) {
            rmSync(temporaryDirectory, { force: true, recursive: true });
            reject(new Error('The compiled server snapshot is required'));
            return;
        }
        const entryPath = join(compiledSnapshot, entryFileName(scenario));
        const wrapperPath = join(temporaryDirectory, 'wrapper.mjs');
        writeFileSync(wrapperPath, preloadSource(scenario, entryPath), 'utf8');
        const child = spawn(process.execPath, [wrapperPath], {
            cwd: temporaryDirectory,
            env: { ...process.env, PATH: process.env.PATH },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (child.stdout === null || child.stderr === null) {
            child.kill();
            rmSync(temporaryDirectory, { force: true, recursive: true });
            reject(new Error('The compiled management child must expose stdout and stderr pipes'));
            return;
        }
        const stdoutPipe = child.stdout;
        const stderrPipe = child.stderr;
        let stdout = '';
        let stderr = '';
        let deadline: NodeJS.Timeout | undefined;
        let timedOut = false;
        let killTimer: NodeJS.Timeout | undefined;
        let settled = false;
        let terminatedAfterObservation = false;
        let terminationStarted = false;
        let closeEvents = 0;
        let temporaryDirectoryRemovals = 0;
        const terminate = () => {
            if (terminationStarted) return;
            terminationStarted = true;
            child.kill('SIGTERM');
            killTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
        };
        const onStdoutData = (chunk: string) => {
            stdout += chunk;
            if (
                terminateAfterEvent !== undefined &&
                !terminatedAfterObservation &&
                stdout.split('\n').includes(terminateAfterEvent)
            ) {
                terminatedAfterObservation = true;
                terminate();
            }
        };
        const onStderrData = (chunk: string) => {
            stderr += chunk;
        };
        let finish: (error: Error | undefined, code: number | null, signal: NodeJS.Signals | null) => void;
        const onError = (error: Error) => finish(error, null, null);
        const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
            closeEvents += 1;
            finish(undefined, code, signal);
        };
        const resourceSnapshot = () => ({
            child: {
                closeEvents,
                closeListeners: child.listenerCount('close'),
                errorListeners: child.listenerCount('error'),
            },
            databaseHandle: {
                connectionCloseEnds: stdout.split('\n').filter(value => value === 'db:close:end').length,
                connectionCloseStarts: stdout.split('\n').filter(value => value === 'db:close:start').length,
                opened: stdout.split('\n').filter(value => value === 'db:handle:opened').length,
                released: stdout.split('\n').filter(value => value === 'db:handle:released').length,
            },
            pipes: {
                stderr: { dataListeners: stderrPipe.listenerCount('data'), destroyed: stderrPipe.destroyed },
                stdout: { dataListeners: stdoutPipe.listenerCount('data'), destroyed: stdoutPipe.destroyed },
            },
            temporaryDirectory: {
                created: 1,
                exists: existsSync(temporaryDirectory),
                removed: temporaryDirectoryRemovals,
            },
        });
        const releaseResources = () => {
            child.removeListener('error', onError);
            child.removeListener('close', onClose);
            stdoutPipe.removeListener('data', onStdoutData);
            stderrPipe.removeListener('data', onStderrData);
            stdoutPipe.destroy();
            stderrPipe.destroy();
            rmSync(temporaryDirectory, { force: true, recursive: true });
            temporaryDirectoryRemovals += 1;
        };
        stdoutPipe.setEncoding('utf8');
        stderrPipe.setEncoding('utf8');
        stdoutPipe.on('data', onStdoutData);
        stderrPipe.on('data', onStderrData);
        deadline = setTimeout(() => {
            timedOut = true;
            terminate();
        }, hardDeadlineMs ?? 2_000);
        finish = (error: Error | undefined, code: number | null, signal: NodeJS.Signals | null) => {
            if (settled) return;
            settled = true;
            if (deadline !== undefined) clearTimeout(deadline);
            if (killTimer !== undefined) clearTimeout(killTimer);
            releaseResources();
            if (error !== undefined) {
                reject(error);
                return;
            }
            resolve({
                code,
                events: stdout.trim().split('\n').filter(Boolean),
                resources: resourceSnapshot(),
                signal,
                stderr,
                terminatedAfterObservation,
                timedOut,
            });
        };
        child.on('error', onError);
        child.on('close', onClose);
    });

describe('compiled management CLI process characterization', () => {
    it.each(traceRows)('[MT-5.3/$id] executes its deterministic $outcome trace', async row => {
        const { absent = [], expected = [], outcome, scenario, stderr } = row;
        const result = await run(
            scenario!,
            outcome === 'pending' ? { hardDeadlineMs: 2_000, terminateAfterEvent: 'db:check' } : undefined,
        );
        if (outcome === 'success') {
            expect(result).toMatchObject({ code: 0, signal: null, timedOut: false, stderr: '' });
            expect(result.events).toEqual(successEvents[scenario!]);
            expectEventsInOrder(result.events, expected);
            expectEventsAbsent(result.events, absent);
            return;
        }
        if (outcome === 'pending') {
            expect(result).toMatchObject({
                code: null,
                signal: 'SIGTERM',
                timedOut: false,
                terminatedAfterObservation: true,
            });
            expectEventsInOrder(result.events, expected);
            expectEventsAbsent(result.events, absent);
            expect(result.events).not.toContain('log:--- finish ---');
            return;
        }

        expect(result).toMatchObject({ code: 1, signal: null, timedOut: false });
        if (stderr !== undefined) expect(result.stderr).toContain(stderr);
        expectEventsInOrder(result.events, expected);
        expectEventsAbsent(result.events, absent);
        expect(result.events).not.toContain('log:--- finish ---');
        expect(result.events).not.toContain('process:exit:0');
    });

    it.each([
        ['db-invalid-missing', '引数が足りません'],
        ['db-invalid-mode', 'mode の指定が間違っています'],
        ['v1-invalid', 'v1のバックアップファイルを指定してください'],
    ])('[MT-1.1-MT-1.5/MT-5.6] exits 1 for compiled %s input and releases the child', async (scenario, message) => {
        const result = await run(scenario);
        expect(result).toMatchObject({ code: 1, signal: null, timedOut: false });
        expect(result.stderr).toContain(message);
        expect(result.events).toEqual(['container:set', 'process:exit:1']);
    });

    it.each([
        [
            'restore-parse-reject',
            'file parse error',
            [
                'container:set',
                'logger:init',
                'log:--- run ---',
                'db:check',
                'db:ready',
                'log:--- start restore ---',
                'log:--- read backup file ---',
                'file:read',
            ],
            'log:--- restore ---',
        ],
        [
            'backup-stage-reject',
            'synthetic backup stage rejection',
            [
                'container:set',
                'logger:init',
                'log:--- run ---',
                'db:check',
                'db:ready',
                'log:--- start backup ---',
                'log:rule',
                'read:rule',
                'log:reserve',
                'read:reserve',
            ],
            'log:drop log file',
        ],
        [
            'restore-stage-reject',
            'synthetic restore stage rejection',
            [
                'container:set',
                'logger:init',
                'log:--- run ---',
                'db:check',
                'db:ready',
                'log:--- start restore ---',
                'log:--- read backup file ---',
                'file:read',
                'log:--- restore ---',
                'log:rule',
                'restore:rule',
                'restore:rule:items-1',
                'log:reserve',
                'restore:reserve',
                'restore:reserve:items-1',
                'log:drop log file',
                'restore:drop-log',
                'restore:drop-log:items-1',
            ],
            'log:recorded',
        ],
        [
            'v1-stage-reject',
            'synthetic v1 stage rejection',
            [
                'container:set',
                'logger:init',
                'log:--- run ---',
                'log:--- read old backup file ---',
                'file:read',
                'file:read:v1-final-schema',
                'db:check',
                'db:ready',
                'log:--- import rules ---',
                'insert:rule',
                'insert:rule:old-id-1:new-id-71',
            ],
            'log:--- import recorded ---',
        ],
    ])(
        '[MT-5.3/MT-5.6] exits 1 before the first forbidden successor for compiled %s',
        async (scenario, message, prefix, forbidden) => {
            const result = await run(scenario);
            expect(result).toMatchObject({ code: 1, signal: null, timedOut: false });
            expect(result.stderr).toContain(message);
            expect(result.events.slice(0, prefix.length)).toEqual(prefix);
            expect(result.events).not.toContain(forbidden);
            expect(result.events).not.toContain('log:--- finish ---');
            expect(result.events).not.toContain('process:exit:0');
        },
    );

    it('[MT-5.3/MT-5.6] logs a compiled v1 parse failure before it can probe, close, finish, or exit successfully', async () => {
        const result = await run('v1-parse-reject');
        expect(result).toMatchObject({ code: 1, signal: null, timedOut: false, stderr: '' });
        expect(result.events.slice(0, 6)).toEqual([
            'container:set',
            'logger:init',
            'log:--- run ---',
            'log:--- read old backup file ---',
            'file:read',
            'error:file parse error',
        ]);
        expect(result.events).not.toContain('db:check');
        expect(result.events).not.toContain('db:close:start');
        expect(result.events).not.toContain('log:--- finish ---');
        expect(result.events).not.toContain('process:exit:0');
    });

    it.each(['backup-success', 'restore-success', 'v1-success'])(
        '[MT-1.1-MT-1.3/MT-5.4-MT-5.6] completes the compiled %s path with ordered progress and exit 0',
        async scenario => {
            const result = await run(scenario);
            expect(result).toMatchObject({ code: 0, signal: null, timedOut: false, stderr: '' });
            expect(result.events).toEqual(successEvents[scenario]);
        },
    );

    it('[MT-5.2/MT-5.3] keeps operation, close, finish, and exit behind a long-pending compiled DB probe', async () => {
        const result = await run('backup-db-pending', { hardDeadlineMs: 2_000, terminateAfterEvent: 'db:check' });
        expect(result).toMatchObject({
            code: null,
            signal: 'SIGTERM',
            timedOut: false,
            terminatedAfterObservation: true,
        });
        expect(result.events).toContain('db:check');
        expect(result.events).not.toContain('db:ready');
        expect(result.events.some(value => value.startsWith('read:'))).toBe(false);
        expect(result.events).not.toContain('db:close:start');
        expect(result.events).not.toContain('log:--- finish ---');
        expect(result.events).not.toContain('process:exit:0');
    });

    it('[INT-BOUNDARY-MT-7.4/INT-CLI/compiled-cli-exit-progress-cancel] terminates a pending compiled DB probe only after observation and releases each harness resource once', async () => {
        const result = await run('backup-db-pending', { hardDeadlineMs: 2_000, terminateAfterEvent: 'db:check' });

        expect(result).toMatchObject({
            code: null,
            signal: 'SIGTERM',
            terminatedAfterObservation: true,
            timedOut: false,
        });
        expectEventsInOrder(result.events, ['db:check', 'db:handle:released']);
        expect(result.events).not.toContain('db:ready');
        expect(result.events).not.toContain('db:close:start');
        expect(result.events).not.toContain('log:--- finish ---');
        expect(result.events).not.toContain('process:exit:0');
        expect(result.resources).toEqual({
            child: { closeEvents: 1, closeListeners: 0, errorListeners: 0 },
            databaseHandle: { connectionCloseEnds: 0, connectionCloseStarts: 0, opened: 1, released: 1 },
            pipes: {
                stderr: { dataListeners: 0, destroyed: true },
                stdout: { dataListeners: 0, destroyed: true },
            },
            temporaryDirectory: { created: 1, exists: false, removed: 1 },
        });
    });

    it('[MT-5.4-MT-5.6] keeps finish and success exit behind a long-pending compiled close', async () => {
        const result = await run('backup-close-pending', 300);
        expect(result.timedOut).toBe(true);
        expect(result.events).toContain('file:write:versionless-root');
        expect(result.events).toContain('db:close:start');
        expect(result.events).not.toContain('db:close:end');
        expect(result.events).not.toContain('log:--- finish ---');
        expect(result.events).not.toContain('process:exit:0');
    });

    it.each(['backup-close-reject', 'restore-close-reject', 'v1-close-reject'])(
        '[MT-5.3/MT-5.4-MT-5.6] exits nonzero and never reports finish when compiled %s rejects during close',
        async scenario => {
            const result = await run(scenario);
            expect(result).toMatchObject({ code: 1, signal: null, timedOut: false });
            expect(result.stderr).toContain('synthetic close rejection');
            expect(result.events).not.toContain('db:close:end');
            expect(result.events).not.toContain('log:--- finish ---');
            expect(result.events).not.toContain('process:exit:0');
        },
    );

    it('[MT-5.2/MT-5.3] escalates a SIGTERM-ignoring child to SIGKILL after the one-second grace period', async () => {
        const startedAt = Date.now();
        const result = await run('backup-db-pending-ignore-sigterm', 100);
        expect(result).toMatchObject({ code: null, signal: 'SIGKILL', timedOut: true });
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_000);
        expect(result.events).toContain('signal:SIGTERM');
    });

    // Symlink-identity regression: the loader-hook replacements registered by the
    // generated wrapper (see `preloadSource` above) key each `./model/ModelContainer.js` /
    // `./model/ModelContainerSetter.js` / `fs` replacement to `realpathSync(entryPath)`, not the
    // as-given `entryPath` built from `EPGSTATION_SERVER_COMPILED_SNAPSHOT`. Node's ESM loader
    // realpath's every module it loads via `import()` (the wrapper dynamically imports the entry
    // rather than spawning it as the process's own main module -- `--preserve-symlinks-main` is not
    // an alternative, because it makes `Cannot find package 'minimist'` appear: preserving the *main* module's as-given identity anchors bare-specifier package
    // resolution to that same as-given, possibly symlink-external location instead of the real one),
    // so a naive as-given `entryPath` would disagree with the real `context.parentURL` Node reports
    // for the entry's own imports whenever `EPGSTATION_SERVER_COMPILED_SNAPSHOT` traverses a
    // symlinked path component. This spawns the real compiled entry through a symlink wrapping the
    // run's own compiled snapshot directory and asserts the exact same ordered success trace as the
    // non-symlinked case, so it only passes once the seam keys on the resolved entry identity
    // instead of the as-given path.
    it('fires the compiled-management-child loader-hook substitution seam through a symlinked snapshot path', async () => {
        const realSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
        expect(typeof realSnapshot).toBe('string');
        const symlinkRoot = mkdtempSync(join(tmpdir(), 'epgstation-management-cli-symlink-'));
        const symlinkedSnapshot = join(symlinkRoot, 'dist-link');
        symlinkSync(realSnapshot as string, symlinkedSnapshot, process.platform === 'win32' ? 'junction' : 'dir');
        try {
            const result = await run('backup-success', { snapshot: symlinkedSnapshot });
            expect(result).toMatchObject({ code: 0, signal: null, timedOut: false, stderr: '' });
            expect(result.events).toEqual(successEvents['backup-success']);
        } finally {
            rmSync(symlinkRoot, { recursive: true, force: true });
        }
    });
});
