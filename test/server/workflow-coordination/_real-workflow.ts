import 'reflect-metadata';

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { expect, vi } from 'vitest';

import {
    EPGUpdateEvent,
    EventSetter,
    ExternalCommandManageModel,
    makeLogger,
    OperatorEncodeEvent,
    OperatorEncodeEventBinding,
    PromiseQueue,
    RecordedEvent,
    RecordedTagEvent,
    ReserveEvent,
    RuleEvent,
    ThumbnailEvent,
} from '../event-and-hook-delivery/_harness';
import { load } from '../recording-execution/_harness';
import { chunk, createRealTuner, insertReserve, withSqlite, wireRecording } from '../recording-execution/_real-tuner-wiring';
import { immediateRetry, repositoryOperator } from '../persistence/repository-harness';

/*
 * 機能間連携機能の結合 test が共有する、本物の部品の配線。
 * DB は実 SQLite、録画は実 HTTP の tuner server・本物の RecorderModel と RecordingManageModel、予約・ルール・
 * 録画済み番組・タグ・サムネイルの管理 model と event と EventSetter は本物、外部コマンドは実の子 process で動かし、
 * 画面向けの通知の送り口（IPC の notifyClient）とエンコード依頼の送り口（IPC の setEncode）だけを境界として数える。
 */

export const ReservationManageModel = load<new (...args: any[]) => any>(
    'model',
    'operator',
    'reservation',
    'ReservationManageModel.js',
);
export const RuleManageModel = load<new (...args: any[]) => any>('model', 'operator', 'rule', 'RuleManageModel.js');
export const RecordedManageModel = load<new (...args: any[]) => any>(
    'model',
    'operator',
    'recorded',
    'RecordedManageModel.js',
);
export const RecordedTagManadeModel = load<new (...args: any[]) => any>(
    'model',
    'operator',
    'recordedTag',
    'RecordedTagManadeModel.js',
);
export const ThumbnailManageModel = load<new (...args: any[]) => any>(
    'model',
    'operator',
    'thumbnail',
    'ThumbnailManageModel.js',
);
export const VideoUtil = load<new (...args: any[]) => any>('model', 'api', 'video', 'VideoUtil.js');
export const ProgramDB = load<new (...args: any[]) => any>('model', 'db', 'ProgramDB.js');
export const RuleDB = load<new (...args: any[]) => any>('model', 'db', 'RuleDB.js');
export const ChannelDB = load<new (...args: any[]) => any>('model', 'db', 'ChannelDB.js');
export const ReserveDB = load<new (...args: any[]) => any>('model', 'db', 'ReserveDB.js');
export const RecordedDB = load<new (...args: any[]) => any>('model', 'db', 'RecordedDB.js');
export const RecordedHistoryDB = load<new (...args: any[]) => any>('model', 'db', 'RecordedHistoryDB.js');
export const RecordedTagDB = load<new (...args: any[]) => any>('model', 'db', 'RecordedTagDB.js');
export const VideoFileDB = load<new (...args: any[]) => any>('model', 'db', 'VideoFileDB.js');
export const ThumbnailDB = load<new (...args: any[]) => any>('model', 'db', 'ThumbnailDB.js');
export const DropLogFileDB = load<new (...args: any[]) => any>('model', 'db', 'DropLogFileDB.js');
export const ReserveOptionChecker = load<new (...args: any[]) => any>(
    'model',
    'operator',
    'ReserveOptionChecker.js',
);
const entity = (name: string) => load<new () => Record<string, any>>('db', 'entities', `${name}.js`);
export const Program = entity('Program');
export const Rule = entity('Rule');
export const Recorded = entity('Recorded');
export const RecordedHistory = entity('RecordedHistory');
export const VideoFile = entity('VideoFile');
export const Channel = entity('Channel');

export const programRow = (overrides: Record<string, unknown> = {}) => {
    const name = (overrides.name as string | undefined) ?? 'synthetic-program';
    return Object.assign(new Program(), {
        id: 1_001,
        updateTime: 1,
        channelId: 21,
        eventId: 1_001,
        serviceId: 21,
        networkId: 1,
        channel: 'synthetic-channel',
        channelType: 'GR',
        startAt: Date.now() + 3_600_000,
        endAt: Date.now() + 7_200_000,
        duration: 3_600_000,
        startHour: 0,
        week: 1,
        isFree: true,
        name,
        shortName: name,
        halfWidthName: name,
        description: null,
        halfWidthDescription: null,
        extended: null,
        halfWidthExtended: null,
        rawExtended: null,
        rawHalfWidthExtended: null,
        genre1: null,
        subGenre1: null,
        genre2: null,
        subGenre2: null,
        genre3: null,
        subGenre3: null,
        videoType: null,
        videoResolution: null,
        videoComponentType: null,
        videoStreamContent: null,
        audioSamplingRate: null,
        audioComponentType: null,
        ...overrides,
    });
};

export const ruleOption = (overrides: Record<string, any> = {}) => ({
    isTimeSpecification: false,
    searchOption: { keyword: 'synthetic', name: true, GR: true },
    reserveOption: { enable: true, allowEndLack: true, avoidDuplicate: false },
    ...overrides,
});

export interface WorldOptions {
    /** 録画・外部コマンド・サムネイル・エンコードの設定の上書き。 */
    readonly config?: Record<string, unknown>;
    /** 予約管理の tuner。 */
    readonly tuners?: ReadonlyArray<{ types: string[] }>;
}

/** 外部コマンドが書く 1 行ずつの記録を読む。 */
export const hookLines = async (file: string): Promise<string[]> =>
    (await readFile(file, 'utf8').catch(() => ''))
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

/** 期待の行数が揃うまで待ち、余分な起動が無いことを見るために少し置いてから全行を返す。 */
export const settledHookLines = async (file: string, expected: number): Promise<string[]> => {
    await vi.waitFor(async () => expect((await hookLines(file)).length).toBeGreaterThanOrEqual(expected), {
        interval: 50,
        timeout: 15_000,
    });
    await new Promise(resolve => setTimeout(resolve, 400));
    return hookLines(file);
};

export const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

/** 非同期に進む後続処理の結果が DB などに現れるまで待つ。 */
export const eventually = (assertion: () => Promise<void> | void, timeout = 15_000): Promise<void> =>
    vi.waitFor(assertion, { interval: 50, timeout });

export const createWorld = async (source: DataSource, root: string, options: WorldOptions = {}) => {
    const log = makeLogger();
    const loggerModel = { getLogger: () => log };
    const thumbnailDir = join(root, 'thumbnail');
    const dropLogDir = join(root, 'droplog');
    await Promise.all([thumbnailDir, dropLogDir].map(path => mkdir(path, { recursive: true })));
    const hookLog = join(root, 'hook-calls.log');
    const hookScript = join(root, 'append-label.cjs');
    await writeFile(
        hookScript,
        [
            "const fs = require('node:fs');",
            'const e = process.env;',
            'fs.appendFileSync(process.argv[2], [process.argv[3], e.RESERVEID ?? "", e.RECORDEDID ?? "", e.PROGRAMID ?? "", e.VIDEOFILEID ?? "", e.MODE ?? ""].join(":") + "\\n");',
        ].join('\n'),
    );
    const thumbnailScript = join(root, 'make-thumbnail.cjs');
    await writeFile(thumbnailScript, "require('node:fs').writeFileSync(process.argv[3], 'synthetic-jpeg');\n");
    const command = (label: string) => `%NODE% ${hookScript} ${hookLog} ${label}`;
    const config: Record<string, any> = {
        conflictPriority: 9,
        dropLog: dropLogDir,
        encodingFinishCommand: command('encoded'),
        ffmpeg: process.execPath,
        hookCommandMaxPending: 64,
        hookCommandTimeoutMs: 10_000,
        isEnabledDropCheck: false,
        isSuppressReservesUpdateAllLog: false,
        recPriority: 2,
        recordedFileExtension: '.ts',
        recordedFormat: 'synthetic-session',
        recordedHistoryRetentionPeriodDays: 7,
        recordingFailedCommand: command('failed'),
        recordingFinishCommand: command('finish'),
        recordingPrepRecFailedCommand: command('prep-failed'),
        recordingPreStartCommand: command('prep-start'),
        recordingStartCommand: command('start'),
        reserveNewAddtionCommand: command('reserve-added'),
        reserveUpdateCommand: command('reserve-updated'),
        reservedeletedCommand: command('reserve-deleted'),
        thumbnail: thumbnailDir,
        thumbnailCmd: `%FFMPEG% ${thumbnailScript} %INPUT% %OUTPUT%`,
        thumbnailPosition: 1,
        thumbnailSize: '8x8',
        timeSpecifiedEndMargin: 0,
        timeSpecifiedStartMargin: 0,
    };
    // 録画先の設定は、保存 path を表す項目なので、literal の object の外で作る。
    config.recorded = [{ name: 'synthetic-root', path: root }];
    Object.assign(config, options.config);
    const configuration = { getConfig: () => config };

    const operator = repositoryOperator(source);
    const programDB = new ProgramDB(loggerModel, { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) }, operator, immediateRetry);
    const ruleDB = new RuleDB(operator, immediateRetry);
    const channelDB = new ChannelDB(loggerModel, { getConfig: () => ({ needToReplaceEnclosingCharacters: false }) }, operator, immediateRetry);
    const reserveDB = new ReserveDB(operator, immediateRetry);
    const recordedDB = new RecordedDB(operator, immediateRetry);
    const recordedHistoryDB = new RecordedHistoryDB(operator, immediateRetry);
    const recordedTagDB = new RecordedTagDB(operator, immediateRetry);
    const videoFileDB = new VideoFileDB(operator, immediateRetry);
    const thumbnailDB = new ThumbnailDB(operator, immediateRetry);
    const dropLogFileDB = new DropLogFileDB(operator, immediateRetry);
    const videoUtil = new VideoUtil(configuration, videoFileDB, loggerModel);

    const tuner = await createRealTuner();
    const wired = wireRecording(source, root, tuner, { config, log: log as any, programDB, recordedHistoryDB, tuners: options.tuners });
    const events = {
        epg: new EPGUpdateEvent(loggerModel),
        encode: new OperatorEncodeEvent(loggerModel),
        recordedProgram: new RecordedEvent(loggerModel),
        recordedTag: new RecordedTagEvent(loggerModel),
        recording: wired.event,
        reserve: new ReserveEvent(loggerModel),
        rule: new RuleEvent(loggerModel),
        thumbnail: new ThumbnailEvent(loggerModel),
    };
    const reservation = new ReservationManageModel(
        loggerModel,
        configuration,
        { getExecution: vi.fn(async () => 1), unLockExecution: vi.fn() },
        new ReserveOptionChecker(configuration),
        reserveDB,
        channelDB,
        programDB,
        ruleDB,
        events.reserve,
    );
    reservation.setTuners((options.tuners ?? [{ types: ['GR'] }, { types: ['GR'] }]) as any);
    const ruleManage = new RuleManageModel(loggerModel, new ReserveOptionChecker(configuration), ruleDB, events.rule);
    const recorded = new RecordedManageModel(
        loggerModel,
        configuration,
        recordedDB,
        videoFileDB,
        thumbnailDB,
        dropLogFileDB,
        recordedHistoryDB,
        wired.manager,
        events.recordedProgram,
        videoUtil,
        wired.recordingUtil,
    );
    const tags = new RecordedTagManadeModel(loggerModel, recordedTagDB, events.recordedTag);
    const thumbnail = new ThumbnailManageModel(
        loggerModel,
        configuration,
        new PromiseQueue(),
        recordedDB,
        videoFileDB,
        thumbnailDB,
        events.thumbnail,
        videoUtil,
    );
    const hooks = new ExternalCommandManageModel(
        loggerModel,
        configuration,
        new PromiseQueue(),
        { findId: vi.fn(async () => ({ halfWidthName: 'synthetic-channel', name: 'synthetic-channel' })) },
        recordedDB,
        videoUtil,
    );
    const ipc = { notifyClient: vi.fn(), setEncode: vi.fn() };
    const setter = new EventSetter(
        loggerModel,
        events.epg,
        events.encode,
        events.rule,
        events.reserve,
        events.recording,
        events.recordedTag,
        events.recordedProgram,
        events.thumbnail,
        reservation,
        wired.manager,
        recorded,
        tags,
        thumbnail,
        hooks,
        ipc,
        configuration,
        new OperatorEncodeEventBinding({ register: vi.fn() }, events.encode),
    );

    /** 実 DB へ行を直接入れる（実 DB のまま、test が状態を作る）。 */
    const save = async (target: new () => Record<string, any>, rows: Array<Record<string, any>>) => {
        await source.getRepository(target).insert(rows);
    };
    /** 実 DB へ SQL を直接流す（行の書き換えや、失敗させる trigger の作成に使う）。 */
    const query = (sql: string, parameters: unknown[] = []) => source.query(sql, parameters);

    return {
        channelDB,
        config,
        dropLogFileDB,
        events,
        hookLog,
        hooks,
        ipc,
        log,
        loggerModel,
        operator,
        programDB,
        query,
        recorded,
        recordedDB,
        recordedHistoryDB,
        recordedTagDB,
        reservation,
        reserveDB,
        root,
        ruleDB,
        save,
        source,
        ruleManage,
        setter,
        tags,
        thumbnail,
        thumbnailDB,
        tuner,
        videoFileDB,
        videoUtil,
        wired,
        /** 後始末（scheduler・録画・tuner server を止める）。 */
        shutdown: async () => {
            await wired.shutdown();
            await tuner.close();
        },
    };
};

export type World = Awaited<ReturnType<typeof createWorld>>;

/** 録画の候補になる前（待機中）の予約を、番組と一緒に DB へ作る。 */
export const addWaitingReserve = async (
    world: World,
    options: { id: number; programId: number; reserve?: Record<string, unknown>; program?: Record<string, unknown> },
) => {
    const now = Date.now();
    await world.save(Program, [
        programRow({
            endAt: now + 180_000,
            id: options.programId,
            eventId: options.programId,
            startAt: now + 120_000,
            ...options.program,
        }),
    ]);
    return insertReserve(world.source, {
        endAt: now + 180_000,
        id: options.id,
        programId: options.programId,
        startAt: now + 120_000,
        ...options.reserve,
    });
};

/**
 * 番組と予約を DB に作り、その予約の録画を本物の RecorderModel で準備から開始まで進める（tuner server が最初の data を送る）。
 * 返す `sender` で録画の data を足し、`sender.end()` で放送の終わりにできる。
 */
export const startRecording = async (
    world: World,
    options: { id: number; programId: number; reserve?: Record<string, unknown>; program?: Record<string, unknown> },
) => {
    const reserve = await addWaitingReserve(world, options);
    const recorder = (await world.wired.startAll([options.id])).get(options.id);
    const preparation = recorder.startPreparation();
    const sender = await world.tuner.sender(options.programId);
    await sender.write(chunk(0));
    await preparation;
    await eventually(() => expect(world.wired.started).toHaveBeenCalled());
    return { preparation, recorder, reserve, sender };
};

/** 実 SQLite（一時 directory の file）と一時 directory を用意して `operation` を流す。 */
export const withWorld = async (options: WorldOptions, operation: (world: World) => Promise<void>): Promise<void> =>
    withSqlite(async (source, root) => {
        const world = await createWorld(source, root, options);
        try {
            await operation(world);
        } finally {
            await world.shutdown();
        }
    });
