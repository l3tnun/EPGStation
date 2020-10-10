import * as fs from 'fs';
import minimist from 'minimist';
import 'reflect-metadata';
import { install } from 'source-map-support';
import DropLogFile from './db/entities/DropLogFile';
import Recorded from './db/entities/Recorded';
import RecordedHistory from './db/entities/RecordedHistory';
import RecordedTag from './db/entities/RecordedTag';
import Reserve from './db/entities/Reserve';
import Thumbnail from './db/entities/Thumbnail';
import VideoFile from './db/entities/VideoFile';
import IDBOperator from './model/db/IDBOperator';
import IDropLogFileDB from './model/db/IDropLogFileDB';
import IRecordedDB from './model/db/IRecordedDB';
import IRecordedHistoryDB from './model/db/IRecordedHistoryDB';
import IRecordedTagDB from './model/db/IRecordedTagDB';
import IReserveDB from './model/db/IReserveDB';
import IRuleDB, { RuleWithCnt } from './model/db/IRuleDB';
import IThumbnailDB from './model/db/IThumbnailDB';
import IVideoFileDB from './model/db/IVideoFileDB';
import IConnectionCheckModel from './model/IConnectionCheckModel';
import ILogger from './model/ILogger';
import ILoggerModel from './model/ILoggerModel';
import container from './model/ModelContainer';
import * as containerSetter from './model/ModelContainerSetter';
install();

containerSetter.set(container);

interface BackupData {
    ruleItems: RuleWithCnt[];
    reserveItems: Reserve[];
    recordedItems: Recorded[];
    thumbnailItems: Thumbnail[];
    videoFileItems: VideoFile[];
    dropLogFileItems: DropLogFile[];
    recordedHistoryItems: RecordedHistory[];
    recordedTagItems: RecordedTag[];
}

class DBTools {
    private filePath: string;
    private mode: 'backup' | 'restore';

    private log: ILogger;
    private connectionChecker: IConnectionCheckModel;
    private dbOperator: IDBOperator;
    private dropLogFileDB: IDropLogFileDB;
    private recordedDB: IRecordedDB;
    private recordedHistoryDB: IRecordedHistoryDB;
    private recordedTagDB: IRecordedTagDB;
    private reserveDB: IReserveDB;
    private ruleDB: IRuleDB;
    private thumbnailDB: IThumbnailDB;
    private videoFileDB: IVideoFileDB;

    constructor() {
        // 引数チェック
        const args = minimist(process.argv.slice(2), {
            alias: {
                m: 'mode',
                o: 'output',
            },
            string: ['output', 'mode'],
        });

        if (
            typeof args.output === 'undefined' ||
            args.output === '' ||
            typeof args.mode === 'undefined' ||
            args.mode === ''
        ) {
            console.error('引数が足りません');
            process.exit(1);
        }

        if (args.mode !== 'backup' && args.mode !== 'restore') {
            console.error('mode の指定が間違っています');
            process.exit(1);
        }

        this.filePath = args.output;
        this.mode = args.mode;

        const logger = container.get<ILoggerModel>('ILoggerModel');
        logger.initialize();
        this.log = logger.getLogger();
        this.connectionChecker = container.get<IConnectionCheckModel>('IConnectionCheckModel');
        this.dbOperator = container.get<IDBOperator>('IDBOperator');
        this.dropLogFileDB = container.get<IDropLogFileDB>('IDropLogFileDB');
        this.recordedDB = container.get<IRecordedDB>('IRecordedDB');
        this.recordedHistoryDB = container.get<IRecordedHistoryDB>('IRecordedHistoryDB');
        this.recordedTagDB = container.get<IRecordedTagDB>('IRecordedTagDB');
        this.reserveDB = container.get<IReserveDB>('IReserveDB');
        this.ruleDB = container.get<IRuleDB>('IRuleDB');
        this.thumbnailDB = container.get<IThumbnailDB>('IThumbnailDB');
        this.videoFileDB = container.get<IVideoFileDB>('IVideoFileDB');
    }

    /**
     * run
     */
    public async run(): Promise<void> {
        this.log.system.info('--- run ---');

        // DB との接続確認
        await this.connectionChecker.checkDB();

        if (this.mode === 'backup') {
            await this.backup();
        } else {
            await this.restore();
        }

        // DB 切断
        await this.dbOperator.closeConnection();
        this.log.system.info('--- finish ---');

        process.exit(0);
    }

    /**
     * backup
     */
    private async backup(): Promise<void> {
        this.log.system.info('--- start backup ---');

        this.log.system.info('rule');
        const [ruleItems] = await this.ruleDB.findAll({}, true);

        this.log.system.info('reserve');
        const [reserveItems] = await this.reserveDB.findAll({ isHalfWidth: false });

        this.log.system.info('drop log file');
        const dropLogFileItems = await this.dropLogFileDB.findAll();

        this.log.system.info('recorded');
        const [recordedItems] = await this.recordedDB.findAll(
            {
                isHalfWidth: false,
            },
            {
                isNeedVideoFiles: false,
                isNeedThumbnails: false,
                isNeedsDropLog: false,
                isNeedTags: false,
            },
        );
        /*
        recordedItems = recordedItems.map(r => {
            r.dropLogFileId = null;

            return r;
        });
        */

        this.log.system.info('thumbnail file');
        const thumbnailItems = await this.thumbnailDB.findAll();

        this.log.system.info('video file');
        const videoFileItems = await this.videoFileDB.findAll();

        this.log.system.info('recorded history');
        const recordedHistoryItems = await this.recordedHistoryDB.findAll();

        this.log.system.info('recorded tag');
        const [recordedTagItems] = await this.recordedTagDB.findAll({});

        const backup: BackupData = {
            ruleItems: ruleItems as RuleWithCnt[],
            reserveItems: reserveItems,
            recordedItems: recordedItems,
            thumbnailItems: thumbnailItems,
            videoFileItems: videoFileItems,
            dropLogFileItems: dropLogFileItems,
            recordedHistoryItems: recordedHistoryItems,
            recordedTagItems: recordedTagItems,
        };

        this.log.system.info('--- writing ---');

        fs.writeFileSync(this.filePath, JSON.stringify(backup), { encoding: 'utf-8' });
    }

    /**
     * restore
     */
    private async restore(): Promise<void> {
        this.log.system.info('--- start restore ---');

        // read backup
        this.log.system.info('--- read backup file ---');
        let backup: BackupData;
        try {
            const file: string | null = fs.readFileSync(this.filePath, 'utf-8');
            if (file === null) {
                throw new Error('file is null');
            }
            backup = JSON.parse(file);
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error(`${this.filePath} is not found`);
                process.exit(1);
            } else {
                console.error('file parse error');
                console.error(err);
                process.exit(1);
            }
        }

        // restore
        this.log.system.info('--- restore ---');
        this.log.system.info('rule');
        await this.ruleDB.restore(backup.ruleItems);

        this.log.system.info('reserve');
        await this.reserveDB.restore(backup.reserveItems);

        this.log.system.info('drop log file');
        await this.dropLogFileDB.restore(backup.dropLogFileItems).catch(err => {
            console.error(err);
            process.exit(1);
        });

        this.log.system.info('recorded');
        await this.recordedDB.restore(backup.recordedItems);

        this.log.system.info('thumbnail file');
        await this.thumbnailDB.restore(backup.thumbnailItems);

        this.log.system.info('video file');
        await this.videoFileDB.restore(backup.videoFileItems);

        this.log.system.info('recorded history');
        await this.recordedHistoryDB.restore(backup.recordedHistoryItems);

        this.log.system.info('recorded tag');
        await this.recordedTagDB.restore(backup.recordedTagItems);
    }
}

new DBTools().run();
