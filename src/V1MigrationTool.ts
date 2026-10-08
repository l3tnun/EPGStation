import * as fs from 'fs';
import minimist from 'minimist';
import 'reflect-metadata';
import { install } from 'source-map-support';
import type * as apid from '../api.js';
import Recorded from './db/entities/Recorded.js';
import RecordedHistory from './db/entities/RecordedHistory.js';
import Thumbnail from './db/entities/Thumbnail.js';
import VideoFile from './db/entities/VideoFile.js';
import IDBOperator from './model/db/IDBOperator.js';
import IRecordedDB from './model/db/IRecordedDB.js';
import IRecordedHistoryDB from './model/db/IRecordedHistoryDB.js';
import IRuleDB from './model/db/IRuleDB.js';
import IThumbnailDB from './model/db/IThumbnailDB.js';
import IVideoFileDB from './model/db/IVideoFileDB.js';
import IConfigFile from './model/IConfigFile.js';
import IConfiguration from './model/IConfiguration.js';
import IConnectionCheckModel from './model/IConnectionCheckModel.js';
import ILogger from './model/ILogger.js';
import ILoggerModel from './model/ILoggerModel.js';
import container from './model/ModelContainer.js';
import * as containerSetter from './model/ModelContainerSetter.js';
import StrUtil from './util/StrUtil.js';
import type { OldBackupData, OldEncodedItem, OldRecordedHistoryItem, OldRecordedItem, OldRuleItem } from './v1.js';
import { fileURLToPath } from 'url';
import { resolve } from 'path';

install();

containerSetter.set(container);

interface RuleIndex {
    [oldRuleId: number]: apid.RuleId;
}

interface RecordedIndex {
    [oldRecorded: number]: apid.RecordedId;
}

interface NewRecordedData {
    recorded: Recorded;
    thumbnail?: Thumbnail;
    videoFile?: VideoFile;
}

/**
 * EPGStation v1 のバックアップファイル（`OldBackupData`形式のJSON）を読み込み、rule・録画済み
 * 番組・録画履歴・サムネイル・ビデオファイル情報を現行スキーマへ変換してDBへ投入するCLIツール。
 * `--input <path>` で入力fileを指定し、`run()` を1回実行して終了する（常駐しないスクリプト）。
 * file末尾で、この file が直接起動された場合のみ自動的にインスタンス化・実行される。
 */
class V1MigrationTool {
    private log: ILogger;
    private config: IConfigFile;
    private connectionChecker: IConnectionCheckModel;
    private dbOperator: IDBOperator;
    private recordedDB: IRecordedDB;
    private recordedHistoryDB: IRecordedHistoryDB;
    private ruleDB: IRuleDB;
    private thumbnailDB: IThumbnailDB;
    private videoFileDB: IVideoFileDB;

    /** `--input` で指定された、v1バックアップJSONファイルのパス。 */
    private v1BackupFilePath: string;

    constructor() {
        // 引数チェック
        const args = minimist(process.argv.slice(2), {
            alias: {
                i: 'input',
            },
            string: ['input'],
        });

        if (typeof args.input === 'undefined') {
            console.error('v1のバックアップファイルを指定してください');
            process.exit(1);
        }

        this.v1BackupFilePath = args.input;

        const logger = container.get<ILoggerModel>('ILoggerModel');
        logger.initialize();
        this.log = logger.getLogger();
        this.config = container.get<IConfiguration>('IConfiguration').getConfig();
        this.dbOperator = container.get<IDBOperator>('IDBOperator');
        this.connectionChecker = container.get<IConnectionCheckModel>('IConnectionCheckModel');
        this.dbOperator = container.get<IDBOperator>('IDBOperator');
        this.recordedDB = container.get<IRecordedDB>('IRecordedDB');
        this.recordedHistoryDB = container.get<IRecordedHistoryDB>('IRecordedHistoryDB');
        this.ruleDB = container.get<IRuleDB>('IRuleDB');
        this.thumbnailDB = container.get<IThumbnailDB>('IThumbnailDB');
        this.videoFileDB = container.get<IVideoFileDB>('IVideoFileDB');
    }

    /**
     * run
     * @return Promise<void>
     */
    public async run(): Promise<void> {
        this.log.system.info('--- run ---');

        // 予約情報を追加する親ディレクトリ名の取得
        const parentRecordedName = this.config.recorded[0].name;
        if (typeof parentRecordedName !== 'string') {
            this.log.system.error('check recorded name error');
        }

        // v1 のバックアップファイル読み取り
        const oldBackupData: OldBackupData = await this.readV1BackupFile();

        // DB との接続確認
        await this.connectionChecker.checkDB();

        // ルールインポート
        this.log.system.info('--- import rules ---');
        const ruleIndex = await this.imporRule(oldBackupData.rules, parentRecordedName);

        // 録画番組のインポート
        this.log.system.info('--- import recorded ---');
        const recordedIndex = await this.importRecorded(oldBackupData.recorded, parentRecordedName, ruleIndex);

        // エンコード済みビデオファイルのインポート
        this.log.system.info('--- import encode video files ---');
        await this.importEncodedVideoFile(oldBackupData.encoded, parentRecordedName, recordedIndex);

        // 録画履歴のインポート
        this.log.system.info('--- import recorded history ---');
        await this.importRecordedHistory(oldBackupData.recordedHistory);

        // DB 切断
        await this.dbOperator.closeConnection();
        this.log.system.info('--- finish ---');

        process.exit(0);
    }

    /**
     * v1 のバックアップファイル読み取り
     * @return Promise<OldBackupData>
     */
    private async readV1BackupFile(): Promise<OldBackupData> {
        // read backup
        this.log.system.info('--- read old backup file ---');

        try {
            const file: string | null = fs.readFileSync(this.v1BackupFilePath, 'utf-8');
            if (file === null) {
                throw new Error('file is null');
            }

            return JSON.parse(file);
        } catch (err: any) {
            if (err.code === 'ENOENT') {
                this.log.system.error(`${this.v1BackupFilePath} is not found`);
                process.exit(1);
            } else {
                this.log.system.error('file parse error');
                this.log.system.error(err);
                process.exit(1);
            }
        }
    }

    /**
     * v1 のルールを DB に登録する
     * @param ruleItem: OldRuleItem[]
     * @param parentDirectoryName: string 親ディレクトリ名
     * @return Promise<RuleIndex>
     */
    private async imporRule(ruleItems: OldRuleItem[], parentDirectoryName: string): Promise<RuleIndex> {
        const ruleIndex: RuleIndex = {};

        for (const oldRule of ruleItems) {
            const newRule = this.convertOldRuleToAddRuleOption(oldRule, parentDirectoryName);
            const newRuleId = await this.ruleDB.insertOnce(newRule);

            ruleIndex[oldRule.id] = newRuleId;
        }

        return ruleIndex;
    }

    /**
     * OldRuleItem から Rule 情報を生成する
     * @param oldRule: OldRuleItem
     * @param parentDirectoryName: string 親ディレクトリ名
     * @return apid.AddRuleOption
     */
    private convertOldRuleToAddRuleOption(oldRule: OldRuleItem, parentDirectoryName: string): apid.AddRuleOption {
        const newRule: apid.AddRuleOption = {
            isTimeSpecification: false,
            searchOption: this.createSearchOption(oldRule),
            reserveOption: this.createReserveOption(oldRule),
            saveOption: this.createSaveOption(oldRule, parentDirectoryName),
        };

        const encodeOption = this.createEncodeOption(oldRule, parentDirectoryName);
        if (encodeOption !== null) {
            newRule.encodeOption = encodeOption;
        }

        return newRule;
    }

    /**
     * v1 のルールから apid.RuleSearchOption を生成する
     * @param oldRule: OldRuleItem
     * @return apid.RuleSearchOption
     */
    private createSearchOption(oldRule: OldRuleItem): apid.RuleSearchOption {
        const searchOption: apid.RuleSearchOption = {};
        if (oldRule.keyword !== null) {
            searchOption.keyword = oldRule.keyword;
        }
        if (oldRule.ignoreKeyword !== null) {
            searchOption.ignoreKeyword = oldRule.ignoreKeyword;
        }
        if (oldRule.keyCS !== null) {
            searchOption.keyCS = oldRule.keyCS;
        }
        if (oldRule.keyRegExp !== null) {
            searchOption.keyRegExp = oldRule.keyRegExp;
        }
        if (oldRule.title !== null) {
            searchOption.name = oldRule.title;
        }
        if (oldRule.description !== null) {
            searchOption.description = oldRule.description;
        }
        if (oldRule.extended !== null) {
            searchOption.extended = oldRule.extended;
        }
        if (oldRule.ignoreKeyCS !== null) {
            searchOption.ignoreKeyCS = oldRule.ignoreKeyCS;
        }
        if (oldRule.ignoreKeyRegExp !== null) {
            searchOption.ignoreKeyRegExp = oldRule.ignoreKeyRegExp;
        }
        if (oldRule.ignoreTitle !== null) {
            searchOption.ignoreName = oldRule.ignoreTitle;
        }
        if (oldRule.ignoreDescription !== null) {
            searchOption.ignoreDescription = oldRule.ignoreDescription;
        }
        if (oldRule.ignoreExtended !== null) {
            searchOption.ignoreExtended = oldRule.ignoreExtended;
        }
        if (oldRule.GR !== null) {
            searchOption.GR = oldRule.GR;
        }
        if (oldRule.BS !== null) {
            searchOption.BS = oldRule.BS;
        }
        if (oldRule.CS !== null) {
            searchOption.CS = oldRule.CS;
        }
        if (oldRule.SKY !== null) {
            searchOption.SKY = oldRule.SKY;
        }
        if (oldRule.station !== null) {
            searchOption.channelIds = [oldRule.station];
        }
        if (oldRule.genrelv1 !== null) {
            if (oldRule.genrelv2 === null) {
                searchOption.genres = [
                    {
                        genre: oldRule.genrelv1,
                    },
                ];
            } else {
                searchOption.genres = [
                    {
                        genre: oldRule.genrelv1,
                        subGenre: oldRule.genrelv2,
                    },
                ];
            }
        }
        if (oldRule.startTime !== null && oldRule.timeRange !== null) {
            searchOption.times = [
                {
                    start: oldRule.startTime,
                    range: oldRule.timeRange,
                    week: oldRule.week,
                },
            ];
        } else {
            searchOption.times = [
                {
                    week: oldRule.week,
                },
            ];
        }
        if (oldRule.isFree !== null) {
            searchOption.isFree = oldRule.isFree;
        }
        if (oldRule.durationMin !== null) {
            searchOption.durationMin = oldRule.durationMin;
        }
        if (oldRule.durationMax !== null) {
            searchOption.durationMax = oldRule.durationMax;
        }

        return searchOption;
    }

    /**
     * v1 のルールから apid.RuleReserveOption を生成する
     * @param oldRule: OldRuleItem
     * @return apid.RuleReserveOption
     */
    private createReserveOption(oldRule: OldRuleItem): apid.RuleReserveOption {
        const reserveOption: apid.RuleReserveOption = {
            enable: oldRule.enable,
            allowEndLack: oldRule.allowEndLack,
            avoidDuplicate: oldRule.avoidDuplicate,
        };

        if (oldRule.periodToAvoidDuplicate !== null) {
            reserveOption.periodToAvoidDuplicate = oldRule.periodToAvoidDuplicate;
        }

        return reserveOption;
    }

    /**
     * v1 のルールから apid.ReserveSaveOption を生成する
     * @param oldRule: OldRuleItem
     * @param parentDirectoryName: string 親ディレクトリ名
     * @return apid.ReserveSaveOption
     */
    private createSaveOption(oldRule: OldRuleItem, parentDirectoryName: string): apid.ReserveSaveOption {
        const saveOption: apid.ReserveSaveOption = {};

        if (oldRule.directory !== null) {
            saveOption.directory = oldRule.directory;
        }
        if (oldRule.recordedFormat !== null) {
            saveOption.recordedFormat = oldRule.recordedFormat;
        }

        saveOption.parentDirectoryName = parentDirectoryName;

        return saveOption;
    }

    /**
     * v1 のルールから apid.ReserveEncodedOption を生成する
     * @param oldRule: OldRuleItem
     * @param parentDirectoryName: string 親ディレクトリ名
     * @return apid.ReserveEncodedOption | null 生成の必要がない場合は null を返す
     */
    private createEncodeOption(oldRule: OldRuleItem, parentDirectoryName: string): apid.ReserveEncodedOption | null {
        const encodeOption: apid.ReserveEncodedOption = {
            isDeleteOriginalAfterEncode: oldRule.delTs === null ? false : oldRule.delTs,
        };

        if (typeof oldRule.mode1 === 'number') {
            encodeOption.mode1 = this.getEncodeOptionName(oldRule.mode1);
            encodeOption.encodeParentDirectoryName1 = parentDirectoryName;
            if (oldRule.directory1 !== null) {
                encodeOption.directory1 = oldRule.directory1;
            }
        }
        if (typeof oldRule.mode2 === 'number') {
            encodeOption.mode2 = this.getEncodeOptionName(oldRule.mode2);
            encodeOption.encodeParentDirectoryName2 = parentDirectoryName;
            if (oldRule.directory2 !== null) {
                encodeOption.directory2 = oldRule.directory2;
            }
        }
        if (typeof oldRule.mode3 === 'number') {
            encodeOption.mode3 = this.getEncodeOptionName(oldRule.mode3);
            encodeOption.encodeParentDirectoryName3 = parentDirectoryName;
            if (oldRule.directory3 !== null) {
                encodeOption.directory3 = oldRule.directory3;
            }
        }

        return Object.keys(encodeOption).length > 1 ? encodeOption : null;
    }

    /**
     * v1 のエンコード指定番号を name に変換する
     * @param num: number
     * @return string
     */
    private getEncodeOptionName(num: number): string {
        const option = this.config.encode[num];
        if (typeof option === 'undefined') {
            this.log.system.error('encodeOptionError');
            this.log.system.error(`encode[${num}] is undefined`);
            throw new Error('EncodeOptionError');
        }

        return option.name;
    }

    /**
     * v1 の番組情報を DB に登録する
     * @param oldRecordedItems: OldRecordedItem[]
     * @param parentDirectoryName: string 親ディレクトリ名
     * @param ruleIndex: RuleIndex
     * @return Promise<RecordedIndex>
     */
    private async importRecorded(
        oldRecordedItems: OldRecordedItem[],
        parentRecordedName: string,
        ruleIndex: RuleIndex,
    ): Promise<RecordedIndex> {
        const recordedIndex: RecordedIndex = {};

        for (const oldRecorded of oldRecordedItems) {
            const recordedData = this.convertOldRecordedToRecorded(oldRecorded, parentRecordedName, ruleIndex);

            // 番組情報追加
            const newRecordedId = await this.recordedDB.insertOnce(recordedData.recorded);
            recordedIndex[oldRecorded.id] = newRecordedId;

            // サムネイル情報追加
            if (typeof recordedData.thumbnail !== 'undefined') {
                recordedData.thumbnail.recordedId = newRecordedId;
                await this.thumbnailDB.insertOnce(recordedData.thumbnail);
            }

            // ts ファイル情報追加
            if (typeof recordedData.videoFile !== 'undefined') {
                recordedData.videoFile.recordedId = newRecordedId;
                await this.videoFileDB.insertOnce(recordedData.videoFile);
            }
        }

        return recordedIndex;
    }

    /**
     * OldRecordedItem から NewRecordedData を生成する
     * @param oldRecorded: OldRecordedItem
     * @param parentDirectoryName: string 親ディレクトリ名
     * @param ruleIndex: 新旧ルールid索引
     * @return NewRecordedData
     */
    private convertOldRecordedToRecorded(
        oldRecorded: OldRecordedItem,
        parentRecordedName: string,
        ruleIndex: RuleIndex,
    ): NewRecordedData {
        const newRecorded = new Recorded();
        newRecorded.reserveId = null;
        const oldRecordedRuleId = oldRecorded.ruleId;
        if (oldRecordedRuleId !== null) {
            const ruleId = ruleIndex[oldRecordedRuleId];
            if (typeof ruleId !== 'undefined') {
                newRecorded.ruleId = ruleId;
            }
        }
        newRecorded.programId = oldRecorded.programId > 0 ? oldRecorded.programId : null; // 負の値は手動予約
        newRecorded.channelId = oldRecorded.channelId;
        newRecorded.isProtected = false;
        newRecorded.startAt = oldRecorded.startAt;
        newRecorded.endAt = oldRecorded.endAt;
        newRecorded.duration = oldRecorded.duration;
        newRecorded.name = oldRecorded.name;
        newRecorded.halfWidthName = StrUtil.toHalf(oldRecorded.name);
        if (oldRecorded.description !== null) {
            newRecorded.description = oldRecorded.description;
            newRecorded.halfWidthDescription = StrUtil.toHalf(oldRecorded.description);
        }
        if (oldRecorded.extended !== null) {
            newRecorded.extended = oldRecorded.extended;
            newRecorded.halfWidthExtended = StrUtil.toHalf(oldRecorded.extended);
        }
        newRecorded.rawExtended = null;
        newRecorded.rawHalfWidthExtended = null;
        newRecorded.genre1 = oldRecorded.genre1;
        newRecorded.subGenre1 = oldRecorded.genre2;
        newRecorded.genre2 = oldRecorded.genre3;
        newRecorded.subGenre2 = oldRecorded.genre4;
        newRecorded.genre3 = oldRecorded.genre5;
        newRecorded.subGenre3 = oldRecorded.genre6;
        newRecorded.videoType = oldRecorded.videoType;
        newRecorded.videoResolution = oldRecorded.videoResolution;
        newRecorded.videoStreamContent = oldRecorded.videoStreamContent;
        newRecorded.videoComponentType = oldRecorded.videoComponentType;
        newRecorded.audioComponentType = oldRecorded.audioComponentType;
        newRecorded.isRecording = false;

        let videoFile: VideoFile | null = null;
        if (oldRecorded.recPath !== null) {
            videoFile = new VideoFile();
            videoFile.parentDirectoryName = parentRecordedName;
            videoFile.filePath = oldRecorded.recPath;
            videoFile.type = 'ts';
            videoFile.name = 'ts';
            videoFile.size = oldRecorded.filesize === null ? 0 : oldRecorded.filesize;
        }

        let thumbnail: Thumbnail | null = null;
        if (oldRecorded.thumbnailPath !== null) {
            thumbnail = new Thumbnail();
            thumbnail.filePath = oldRecorded.thumbnailPath;
        }

        const result: NewRecordedData = {
            recorded: newRecorded,
        };

        if (thumbnail !== null) {
            result.thumbnail = thumbnail;
        }
        if (videoFile !== null) {
            result.videoFile = videoFile;
        }

        return result;
    }

    /**
     * v1 のエンコード済みファイル情報を DB に登録する
     * @param oldEncodedItems: OldEncodedItem[]
     * @param parentDirectoryName: string 親ディレクトリ名
     * @param recordedIndex: RecordedIndex
     * @return Promise<void>
     */
    private async importEncodedVideoFile(
        oldEncodedItems: OldEncodedItem[],
        parentRecordedName: string,
        recordedIndex: RecordedIndex,
    ): Promise<void> {
        for (const oldEncodeItem of oldEncodedItems) {
            const newEncodeItem = this.convertOldEncodedItemToVideoFile(
                oldEncodeItem,
                parentRecordedName,
                recordedIndex,
            );
            await this.videoFileDB.insertOnce(newEncodeItem);
        }
    }

    /**
     * OldEncodedItem から VideoFile を生成する
     * @param oldEncodeItem: OldEncodedItem
     * @param parentDirectoryName: string 親ディレクトリ名
     * @param recordedIndex: RecordedIndex
     * @return VideoFile
     */
    private convertOldEncodedItemToVideoFile(
        oldEncodeItem: OldEncodedItem,
        parentRecordedName: string,
        recordedIndex: RecordedIndex,
    ): VideoFile {
        const newEncodedItem = new VideoFile();
        newEncodedItem.parentDirectoryName = parentRecordedName;
        newEncodedItem.filePath = oldEncodeItem.path;
        newEncodedItem.type = 'encoded';
        newEncodedItem.name = oldEncodeItem.name;
        const recordedId = recordedIndex[oldEncodeItem.recordedId];
        if (typeof recordedId === 'undefined') {
            this.log.system.info(`old recordedId: ${oldEncodeItem.recordedId} is not registered in database`);
            throw new Error('OldRecordedIdError');
        }
        newEncodedItem.size = oldEncodeItem.filesize === null ? 0 : oldEncodeItem.filesize;
        newEncodedItem.recordedId = recordedId;

        return newEncodedItem;
    }

    /**
     * v1 の録画履歴情報を DB に登録する
     * @param oldRecordedHistoryItems: OldRecordedHistoryItem[]
     * @return Promise<void>
     */
    private async importRecordedHistory(oldRecordedHistoryItems: OldRecordedHistoryItem[]): Promise<void> {
        for (const oldItem of oldRecordedHistoryItems) {
            const newItem = new RecordedHistory();
            newItem.name = oldItem.name;
            newItem.channelId = oldItem.channelId;
            newItem.endAt = oldItem.endAt;
            await this.recordedHistoryDB.insertOnce(newItem);
        }
    }
}

export default V1MigrationTool;

// この file が直接起動されたときだけ動かす。ESM に require.main は無いため、実行された
// script の path と自分の path を比べる。
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    new V1MigrationTool().run();
}
