import 'reflect-metadata';

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeLogger } from '../event-and-hook-delivery/_harness';
import { silentLoggerModel } from '../harness/silent-logger-model';

/*
 * 録画済み番組の変更を確定したとき、関係機能（クライアントへの通知）へ知らせることを、本物の部品で確かめる。
 * 実 SQLite の DB、本物の RecordedManageModel・RecordedTagManadeModel、本物の event と EventSetter を繋ぎ、
 * 境界の IPC（クライアントへの通知の送り口）だけを数える。変更が確定しない入力では通知が出ない。
 */

const require = createRequire(join(process.cwd(), 'package.json'));
const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT as string;
const load = <T>(path: string): T => (require(join(snapshot, path)) as { default: T }).default;

const Recorded = load<new () => any>('db/entities/Recorded.js');
const DropLogFile = load<new () => any>('db/entities/DropLogFile.js');
const RecordedDB = load<new (...args: any[]) => any>('model/db/RecordedDB.js');
const VideoFileDB = load<new (...args: any[]) => any>('model/db/VideoFileDB.js');
const ThumbnailDB = load<new (...args: any[]) => any>('model/db/ThumbnailDB.js');
const DropLogFileDB = load<new (...args: any[]) => any>('model/db/DropLogFileDB.js');
const RecordedTagDB = load<new (...args: any[]) => any>('model/db/RecordedTagDB.js');
const RecordedHistoryDB = load<new (...args: any[]) => any>('model/db/RecordedHistoryDB.js');
const RecordedManageModel = load<new (...args: any[]) => any>('model/operator/recorded/RecordedManageModel.js');
const RecordedTagManadeModel = load<new (...args: any[]) => any>(
    'model/operator/recordedTag/RecordedTagManadeModel.js',
);
const RecordedEvent = load<new (...args: any[]) => any>('model/event/RecordedEvent.js');
const RecordedTagEvent = load<new (...args: any[]) => any>('model/event/RecordedTagEvent.js');
const EPGUpdateEvent = load<new (...args: any[]) => any>('model/event/EPGUpdateEvent.js');
const OperatorEncodeEvent = load<new (...args: any[]) => any>('model/event/OperatorEncodeEvent.js');
const ReserveEvent = load<new (...args: any[]) => any>('model/event/ReserveEvent.js');
const RecordingEvent = load<new (...args: any[]) => any>('model/event/RecordingEvent.js');
const RuleEvent = load<new (...args: any[]) => any>('model/event/RuleEvent.js');
const ThumbnailEvent = load<new (...args: any[]) => any>('model/event/ThumbnailEvent.js');
const EventSetter = load<new (...args: any[]) => any>('model/event/EventSetter.js');

const retry = { run: <T>(operation: () => Promise<T>): Promise<T> => operation() };

interface Fixture {
    readonly manage: any;
    readonly tagManage: any;
    readonly recordedDB: any;
    readonly recordedTagDB: any;
    readonly dropLogFileDB: any;
    readonly notifyClient: ReturnType<typeof vi.fn>;
    readonly dropLogDirectory: string;
}

let source: DataSource | undefined;
let root: string | undefined;
let fixture: Fixture;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'epgstation-recorded-notification-'));
    const dropLogDirectory = join(root, 'droplog');
    await mkdir(dropLogDirectory, { recursive: true });
    source = new DataSource({
        type: 'better-sqlite3',
        database: join(root, 'recorded.db'),
        entities: [join(snapshot, 'db', 'entities', '*.js')],
        logging: false,
        synchronize: true,
    });
    await source.initialize();
    const operator = { getConnection: async () => source, getLikeStr: () => 'like' };
    const recordedDB = new RecordedDB(silentLoggerModel, operator, retry);
    const recordedTagDB = new RecordedTagDB(silentLoggerModel, operator, retry);
    const dropLogFileDB = new DropLogFileDB(silentLoggerModel, operator, retry);
    const logger = { getLogger: () => makeLogger() };
    const recordedEvent = new RecordedEvent(logger);
    const recordedTagEvent = new RecordedTagEvent(logger);
    const manage = new RecordedManageModel(
        logger,
        { getConfig: () => ({ dropLog: dropLogDirectory, recorded: [], thumbnail: join(root!, 'thumbnail') }) },
        recordedDB,
        new VideoFileDB(silentLoggerModel, operator, retry),
        new ThumbnailDB(silentLoggerModel, operator, retry),
        dropLogFileDB,
        new RecordedHistoryDB(silentLoggerModel, operator, retry),
        { cancel: vi.fn(), hasReserve: vi.fn(() => false) },
        recordedEvent,
        { getParentDirPath: vi.fn(), getFullFilePathFromVideoFile: vi.fn() },
        {},
    );
    const tagManage = new RecordedTagManadeModel(logger, recordedTagDB, recordedTagEvent);
    const notifyClient = vi.fn();
    const setter = new EventSetter(
        logger,
        new EPGUpdateEvent(logger),
        new OperatorEncodeEvent(logger),
        new RuleEvent(logger),
        new ReserveEvent(logger),
        new RecordingEvent(logger),
        recordedTagEvent,
        recordedEvent,
        new ThumbnailEvent(logger),
        { updateAll: vi.fn(), updateRule: vi.fn(), cancel: vi.fn(), addEventRelay: vi.fn() },
        { acceptMutation: vi.fn(), update: vi.fn(), hasReserve: vi.fn(() => false) },
        manage,
        tagManage,
        { add: vi.fn() },
        {
            addUpdateReseves: vi.fn(),
            addRecordingPrepStartCmd: vi.fn(),
            addRecordingPrepRecFailedCmd: vi.fn(),
            addRecordingStartCmd: vi.fn(),
            addRecordingFailedCmd: vi.fn(),
            addRecordingFinishCmd: vi.fn(),
            addEncodingFinishCmd: vi.fn(),
        },
        { notifyClient, setEncode: vi.fn() },
        { getConfig: () => ({ recorded: [{ name: 'main' }] }) },
        { setup: vi.fn() },
    );
    setter.set();
    fixture = { manage, tagManage, recordedDB, recordedTagDB, dropLogFileDB, notifyClient, dropLogDirectory };
});

afterEach(async () => {
    await source?.destroy();
    source = undefined;
    if (root !== undefined) {
        await rm(root, { force: true, recursive: true });
        root = undefined;
    }
});

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

const newRecordedOption = {
    channelId: 101,
    endAt: 1_700_000_060_000,
    name: 'notification boundary',
    startAt: 1_700_000_000_000,
};

describe('recorded content change notification with real components', () => {
    it('[RC-1.5] notifies the client once after a created recorded row is committed to SQLite', async () => {
        const recordedId = await fixture.manage.createNewRecorded(newRecordedOption);
        await flush();

        expect(fixture.notifyClient).toHaveBeenCalledTimes(1);
        await expect(fixture.recordedDB.findId(recordedId)).resolves.toMatchObject({
            id: recordedId,
            name: 'notification boundary',
        });
    });

    it('[RC-1.5] notifies once for a protection change, none when the recorded row does not exist', async () => {
        const recordedId = await fixture.manage.createNewRecorded(newRecordedOption);
        await flush();
        fixture.notifyClient.mockClear();

        await fixture.manage.changeProtect(recordedId, true);
        await flush();
        expect(fixture.notifyClient).toHaveBeenCalledTimes(1);
        await expect(fixture.recordedDB.findId(recordedId)).resolves.toMatchObject({ isProtected: true });

        fixture.notifyClient.mockClear();
        await expect(fixture.manage.changeProtect(recordedId + 1_000, true)).rejects.toThrow('RecordedIsNull');
        await flush();
        expect(fixture.notifyClient).not.toHaveBeenCalled();
    });

    it('[RC-1.5] notifies once for a tag relation, none when the relation cannot be saved', async () => {
        const recordedId = await fixture.manage.createNewRecorded(newRecordedOption);
        const tagId = await fixture.tagManage.create('notification tag', '#123456');
        await flush();
        fixture.notifyClient.mockClear();

        await fixture.tagManage.setRelation(tagId, recordedId);
        await flush();
        expect(fixture.notifyClient).toHaveBeenCalledTimes(1);
        await expect(fixture.recordedDB.findId(recordedId)).resolves.toMatchObject({
            tags: [{ id: tagId }],
        });

        fixture.notifyClient.mockClear();
        await expect(fixture.tagManage.setRelation(tagId, recordedId + 1_000)).rejects.toThrow();
        await expect(fixture.tagManage.setRelation(tagId + 1_000, recordedId)).rejects.toThrow();
        await flush();
        expect(fixture.notifyClient).not.toHaveBeenCalled();
    });

    it('[RC-1.5] notifies once when drop-log cleanup removes a registration whose file is gone, none when nothing changes', async () => {
        const dropLogFileId = await fixture.dropLogFileDB.insertOnce(
            Object.assign(new DropLogFile(), {
                dropCnt: 0,
                errorCnt: 0,
                filePath: 'missing.log',
                scramblingCnt: 0,
            }),
        );
        await fixture.recordedDB.insertOnce(
            Object.assign(new Recorded(), {
                channelId: 101,
                dropLogFileId,
                duration: 60_000,
                endAt: 1_700_000_060_000,
                halfWidthName: 'with drop log',
                isProtected: false,
                isRecording: false,
                name: 'with drop log',
                startAt: 1_700_000_000_000,
            }),
        );
        await writeFile(join(fixture.dropLogDirectory, 'orphan.log'), 'orphan', 'utf8');

        await fixture.manage.dropLogFileCleanup();
        await flush();
        expect(fixture.notifyClient).toHaveBeenCalledTimes(1);
        await expect(fixture.dropLogFileDB.findId(dropLogFileId)).resolves.toBeNull();
        expect(existsSync(join(fixture.dropLogDirectory, 'orphan.log'))).toBe(false);

        fixture.notifyClient.mockClear();
        await fixture.manage.dropLogFileCleanup();
        await flush();
        expect(fixture.notifyClient).not.toHaveBeenCalled();
    });
});
