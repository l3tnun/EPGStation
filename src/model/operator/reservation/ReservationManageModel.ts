import { inject, injectable } from 'inversify';
import type * as apid from '../../../../api.js';
import Channel from '../../../db/entities/Channel.js';
import Program from '../../../db/entities/Program.js';
import Reserve from '../../../db/entities/Reserve.js';
import DateUtil from '../../../util/DateUtil.js';
import StrUtil from '../../../util/StrUtil.js';
import { hasSubDirectoryOutsideRoot, INVALID_SUB_DIRECTORY_ERROR } from '../../../util/SubDirectoryUtil.js';
import Util from '../../../util/Util.js';
import IChannelDB from '../../db/IChannelDB.js';
import IProgramDB, { ProgramWithOverlap } from '../../db/IProgramDB.js';
import IReserveDB, { IFindTimeRangesOption, IReserveTimeOption } from '../../db/IReserveDB.js';
import IRuleDB, { RuleWithCnt } from '../../db/IRuleDB.js';
import IReserveEvent, { IReserveUpdateValues } from '../../event/IReserveEvent.js';
import IConfigFile from '../../IConfigFile.js';
import IConfiguration from '../../IConfiguration.js';
import IExecutionManagementModel from '../../IExecutionManagementModel.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import { BroadcastType, TunerInfo } from '../../tuner/types.js';
import IReserveOptionChecker from '../IReserveOptionChecker.js';
import IReservationManageModel from './IReservationManageModel.js';
import { RESERVATION_NOT_EDITABLE_ERROR } from './ReservationNotEditableError.js';
import Tuner from './Tuner.js';

/** `createReservesDiff`が新旧の予約一覧を突き合わせる際、`newReserves`側の各要素が
 *  既にいずれかの`oldReserves`と対応付け済みか（`isChecked`）を管理するための作業用の組。 */
interface ReserveDiffData {
    reserve: Reserve;
    isChecked: boolean;
}

/**
 * `IReservationManageModel`の実装。手動予約・ルール予約の追加/更新/削除と、予約同士の
 * 競合（同時に受信できるチューナー数を超える重複）・重複（同一番組への複数予約）の判定を
 * 担う。競合判定は`createReserves`（平面走査法で時間軸を掃引し、チューナーの空きに応じて
 * 予約を割り当てる）で行い、既存の予約一覧との差分は`createReservesDiff`で計算して
 * `IReserveDB`へまとめて反映する。
 */
@injectable()
class ReservationManageModel implements IReservationManageModel {
    private log: ILogger;
    private config: IConfigFile;
    private executeManagementModel: IExecutionManagementModel;
    private optionChecker: IReserveOptionChecker;
    private reserveDB: IReserveDB;
    private channelDB: IChannelDB;
    private programDB: IProgramDB;
    private ruleDB: IRuleDB;
    private reserveEvent: IReserveEvent;
    /** `setTuners`で設定される、現在利用可能なチューナーの一覧。`createReserves`が
     *  競合判定（同時に受信できる本数）に使う。 */
    private tuners: Tuner[] = [];
    /** `setTuners`が算出する、各放送波種別を受信可能なチューナーが1つでも存在するかの一覧。
     *  `getBroadcastStatus`がそのまま返す。 */
    private broadcastStatus: apid.BroadcastStatus = {
        GR: false,
        BS: false,
        CS: false,
        SKY: false,
        BS4K: false,
    };

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IReservationExecutionManagementModel') executeManagementModel: IExecutionManagementModel,
        @inject('IReserveOptionChecker') optionChecker: IReserveOptionChecker,
        @inject('IReserveDB') reserveDB: IReserveDB,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IProgramDB') programDB: IProgramDB,
        @inject('IRuleDB') ruleDB: IRuleDB,
        @inject('IReserveEvent') reserveEvent: IReserveEvent,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.executeManagementModel = executeManagementModel;
        this.optionChecker = optionChecker;
        this.reserveDB = reserveDB;
        this.channelDB = channelDB;
        this.programDB = programDB;
        this.ruleDB = ruleDB;
        this.reserveEvent = reserveEvent;
    }

    /**
     * チューナ情報をセット
     * @param tuners: TunerInfo[]
     */
    public setTuners(tuners: TunerInfo[]): void {
        this.tuners = tuners.map(tuner => {
            // set this.broadcastStatus
            for (const key in this.broadcastStatus) {
                if (tuner.types.indexOf(<BroadcastType>key) !== -1) {
                    (<any>this.broadcastStatus)[key] = true;
                }
            }

            return new Tuner({ types: [...tuner.types] });
        });
    }

    /**
     * 放送波の状態を返す
     * @return apid.BroadcastStatus
     */
    public getBroadcastStatus(): apid.BroadcastStatus {
        return this.broadcastStatus;
    }

    /**
     * 手動予約追加
     */
    public async add(option: apid.ManualReserveOption): Promise<apid.ReserveId> {
        this.log.system.info(
            'add reservation' + (typeof option.programId !== 'undefined' ? `: ${option.programId}` : ''),
        );

        // 保存先の外を指すディレクトリは受け付けない
        this.checkSubDirectories(option);

        // オプションチェック
        if (this.checkManualReserveOption(option) === false) {
            this.log.system.error('add reservation option error');
            throw new Error('AddReservationOptionError');
        }

        let newReserve: Reserve;
        let insertedId: apid.ReserveId;
        const exeId = await this.executeManagementModel.getExecution(ReservationManageModel.ADD_RESERVE_PRIORITY);
        try {
            if (typeof option.programId === 'undefined') {
                newReserve = await this.createManualReserveWithSpecifiedTime(option);
            } else {
                newReserve = await this.createManualReserveWithProgramId(option);
            }
            await this.checkSingleReserveConflict(newReserve);
            insertedId = await this.reserveDB.insertOnce(newReserve).catch(err => {
                this.log.system.info(`add reservation error: ${option.programId}`);
                this.log.system.error(err);
                throw new Error('ReservationManageModelAddReserveError');
            });
            newReserve.id = insertedId;
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        this.log.system.info(
            `successful add reservation: ${insertedId}` +
                (typeof option.programId !== 'undefined' ? `, ${option.programId}` : ''),
        );

        // イベント発行
        this.reserveEvent.emitUpdated({
            insert: [newReserve],
            isSuppressLog: false,
        });

        return insertedId;
    }

    /**
     * イベントリレーによる予約追加
     * @param programId: apid.ProgramId リレー先の program id
     * @param parentReserve: Reserve リレー元の予約情報
     * @returns Promise<apid.ReserveId | null>
     *              apid.ReserveId: 予約 Id. 予約が追加された場合返される
     *              null: すでに予約済み
     */
    public async addEventRelay(programId: apid.ProgramId, parentReserve: Reserve): Promise<apid.ReserveId | null> {
        this.log.system.info(`add event relay. reserveId: ${parentReserve.id}, programId: ${programId}`);

        // すでに録画されていないか検索する
        const reservedPrograms = await this.reserveDB.findProgramId(programId);
        if (reservedPrograms.length > 0) {
            this.log.system.warn(`already reserved program. reserveId: ${parentReserve.id}, programId: ${programId}`);
            return null;
        }

        let newReserve: Reserve;
        let insertedId: apid.ReserveId;
        const exeId = await this.executeManagementModel.getExecution(ReservationManageModel.ADD_RESERVE_PRIORITY);
        try {
            newReserve = await this.createEventRelayReserve(programId, parentReserve);
            await this.checkSingleReserveConflict(newReserve);
            insertedId = await this.reserveDB.insertOnce(newReserve).catch(err => {
                this.log.system.info(`add reservation error: reserveId: ${parentReserve.id}, programId: ${programId}`);
                this.log.system.error(err);
                throw new Error('ReservationManageModelAddReserveError');
            });
            newReserve.id = insertedId;
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        this.log.system.info(
            `successful add event relay. reserveId: ${parentReserve.id}, newReserveId: ${newReserve.id} programId: ${programId}`,
        );

        // イベント発行
        this.reserveEvent.emitUpdated({
            insert: [newReserve],
            isSuppressLog: false,
        });

        return insertedId;
    }

    /**
     * Program Id 指定の手動予約の予約情報を生成する
     * @param option: apid.ManualReserveOption 手動予約オプション
     * @returns: Promise<Reserve> 予約情報
     */
    private async createManualReserveWithProgramId(option: apid.ManualReserveOption): Promise<Reserve> {
        // program id 指定の手動予約じゃない
        if (typeof option.programId === 'undefined') {
            this.log.system.error('failed to create manual reserve. program id is undefined.');
            throw new Error('FailedToCreateManualReserve');
        }

        // すでに予約済みでないかチェック
        try {
            const r = await this.reserveDB.findProgramId(option.programId);
            if (r.length > 0) {
                // すでに予約済み
                this.log.system.error(`program is reserved: ${option.programId}`);
                throw new Error('ReservationManageModelReservedError');
            }
        } catch (err: any) {
            this.log.system.error('check reserved programs error');
            throw new Error('ReservationManageModelCheckReservedProgramError', { cause: err });
        }

        // 予約対象の番組情報を取得する
        let program: Program | null;
        try {
            // 番組情報取得
            program = await this.programDB.findId(option.programId);
        } catch (err: any) {
            this.log.system.error(`program is not found: ${option.programId}`);
            throw err;
        }

        if (program === null) {
            // 指定された program id の番組情報が見つからなかった
            this.log.system.info(`program is not found: ${option.programId}`);
            throw new Error('ProgramIsNotFound');
        }

        // 予約情報生成
        const newReserve = new Reserve();
        newReserve.updateTime = new Date().getTime();
        this.setProgramToReserve(newReserve, program);

        this.setManualReserveOption(option, newReserve);

        return newReserve;
    }

    /**
     * 時刻指定の手動予約の予約情報を生成する
     * @param option: apid.ManualReserveOption 手動予約オプション
     * @returns: Promise<Reserve> 予約情報
     */
    private async createManualReserveWithSpecifiedTime(option: apid.ManualReserveOption): Promise<Reserve> {
        // 時刻指定の手動予約ではない
        if (typeof option.programId !== 'undefined' || typeof option.timeSpecifiedOption === 'undefined') {
            this.log.system.error('time specified option error');
            throw new Error('TimeSpecifiedOptionIsUndefined');
        }

        // name チェック
        if (typeof option.timeSpecifiedOption.name === 'undefined') {
            this.log.system.error('name is undefined');
            throw new Error('NameIsUndefinedError');
        }

        // 時刻チェック
        if (
            option.timeSpecifiedOption.startAt >= option.timeSpecifiedOption.endAt ||
            option.timeSpecifiedOption.endAt <= new Date().getTime()
        ) {
            this.log.system.error('timeSpecifiedOption error');
            throw new Error('TimeSpecifiedOptionError');
        }

        // すでに同じ条件で予約済みでないかチェック
        const oldReserve = await this.reserveDB.findTimeSpecification(option.timeSpecifiedOption).catch(err => {
            this.log.system.error('get old reservation error');
            throw err;
        });
        if (oldReserve !== null) {
            this.log.system.error('conflict add reservation');
            throw new Error('AddReservationConflictError');
        }

        // channel 情報取得
        const channel = await this.channelDB.findId(option.timeSpecifiedOption.channelId).catch(err => {
            if (typeof option.timeSpecifiedOption !== 'undefined') {
                this.log.system.error(`channelId find error: ${option.timeSpecifiedOption.channelId}`);
            }
            this.log.system.error(err);
            throw new Error('ReservationManageModelFindChannelError');
        });
        if (channel === null) {
            this.log.stream.error(`channelId is not found: ${option.timeSpecifiedOption.channelId}`);
            throw new Error('eservationManageModelFindChannelIsNotFound');
        }

        // 予約情報の作成
        const newReserve = new Reserve();
        newReserve.isEventRelay = true;
        newReserve.updateTime = new Date().getTime();
        newReserve.isTimeSpecified = true;
        newReserve.name = StrUtil.toDBStr(option.timeSpecifiedOption.name);
        newReserve.halfWidthName = StrUtil.toHalf(newReserve.name);
        newReserve.startAt = option.timeSpecifiedOption.startAt;
        newReserve.endAt = option.timeSpecifiedOption.endAt;
        newReserve.channelId = channel.id;
        newReserve.channel = channel.channel;
        newReserve.channelType = channel.channelType;

        this.setManualReserveOption(option, newReserve);

        return newReserve;
    }

    /**
     * 手動予約のオプション情報をセットする
     * @param option: apid.ManualReserveOption 手動予約オプション
     * @param newReserve: Reserve セット対象の予約情報
     */
    private setManualReserveOption(option: apid.ManualReserveOption, newReserve: Reserve): void {
        // option から必要な情報をセットする
        newReserve.allowEndLack = option.allowEndLack;
        if (typeof option.tags !== 'undefined') {
            newReserve.tags = JSON.stringify(option.tags);
        }
        if (typeof option.saveOption !== 'undefined') {
            this.setSaveOptionToReserve(newReserve, option.saveOption);
        }
        if (typeof option.encodeOption !== 'undefined') {
            this.setEncodeOptionToReserve(newReserve, option.encodeOption);
        }
    }

    /**
     * イベントリレー用の予約情報を生成する
     * @param programId: apid.ProgramId リレー先の program id
     * @param parentReserve: Reserve リレー元の予約情報
     * @returns: Promise<Reserve> 作成した予約情報
     */
    private async createEventRelayReserve(programId: apid.ProgramId, parentReserve: Reserve): Promise<Reserve> {
        const newReserve = new Reserve();
        newReserve.isEventRelay = true;
        newReserve.updateTime = new Date().getTime();

        // 番組情報を検索する
        let program: Program | null;
        try {
            program = await this.programDB.findId(programId);
        } catch (err: any) {
            // 検索に失敗
            this.log.system.error(`program is not found. ${programId}`);
            throw err;
        }

        if (program === null) {
            // 指定された program id の番組が存在しない
            this.log.system.error(`program is not found. ${programId}`);
            throw new Error('ProgramIsNotFound');
        }

        // 取得した番組情報をセットする
        this.setProgramToReserve(newReserve, program);

        // リレー元の予約情報から必要な情報をセットする
        newReserve.ruleId = parentReserve.ruleId;
        newReserve.allowEndLack = parentReserve.allowEndLack;
        newReserve.tags = parentReserve.tags;
        newReserve.parentDirectoryName = parentReserve.parentDirectoryName;
        newReserve.directory = parentReserve.directory;
        newReserve.recordedFormat = parentReserve.recordedFormat;
        newReserve.encodeMode1 = parentReserve.encodeMode1;
        newReserve.encodeMode2 = parentReserve.encodeMode2;
        newReserve.encodeMode3 = parentReserve.encodeMode3;
        newReserve.encodeParentDirectoryName1 = parentReserve.encodeParentDirectoryName1;
        newReserve.encodeParentDirectoryName2 = parentReserve.encodeParentDirectoryName2;
        newReserve.encodeParentDirectoryName3 = parentReserve.encodeParentDirectoryName3;
        newReserve.encodeDirectory1 = parentReserve.encodeDirectory1;
        newReserve.encodeDirectory2 = parentReserve.encodeDirectory2;
        newReserve.encodeDirectory3 = parentReserve.encodeDirectory3;
        newReserve.isDeleteOriginalAfterEncode = parentReserve.isDeleteOriginalAfterEncode;

        return newReserve;
    }

    /**
     * 引数で指定した予約が追加可能かチェックする。エラーが発生した場合は追加が不可能
     * @param newReserve
     */
    private async checkSingleReserveConflict(newReserve: Reserve): Promise<void> {
        // 追加する予約情報と重複する予約情報を取得 (競合は含め、除外と重複は除く)
        let reserves: Reserve[];
        try {
            reserves = await this.reserveDB.findTimeRanges({
                times: [
                    {
                        startAt: newReserve.startAt,
                        endAt: newReserve.endAt,
                    },
                ],
                hasSkip: false,
                hasConflict: true,
                hasOverlap: false,
            });
        } catch (err: any) {
            this.log.system.error('reservation get error');
            throw err;
        }

        // 保存済みの競合予約は、優先順が上ならチューナーを使うものとして評価集合に含めるが、
        // 競合のままであることだけでは追加を拒否しない（新しい予約と関係の無い競合で拒否しないため）
        const storedConflictIds = new Set<apid.ReserveId>();
        for (const reserve of reserves) {
            if (reserve.isConflict) {
                storedConflictIds.add(reserve.id);
            }
        }

        reserves.push(newReserve);
        const newReserves = this.createReserves(reserves);

        // 新しい予約が競合になるか、保存済みで競合でない予約が競合になる場合は追加しない
        for (const reserve of newReserves) {
            if (reserve.isConflict && !storedConflictIds.has(reserve.id)) {
                this.log.system.error(`program is conflict. programId: ${newReserve.programId}`);
                throw new Error('ReservationManageModelAddReserveConflict');
            }
        }
    }

    /**
     * 保存先内ディレクトリとエンコード出力先ディレクトリが録画保存先の外を指していないかチェックする
     * @param option: ManualReserveOption | EditManualReserveOption
     * @throws 外を指すものがあれば InvalidSubDirectory
     */
    private checkSubDirectories(option: apid.ManualReserveOption | apid.EditManualReserveOption): void {
        if (hasSubDirectoryOutsideRoot(option.saveOption, option.encodeOption) === true) {
            this.log.system.error('sub directory is outside the recorded directory');
            throw new Error(INVALID_SUB_DIRECTORY_ERROR);
        }
    }

    /**
     * 手動予約のプションが正しくセットされているかチェックする
     * @param option: ManualReserveOption | EditManualReserveOption
     * @return 正しくセットされていれば true を返す
     */
    private checkManualReserveOption(option: apid.ManualReserveOption, isEdit: boolean = false): boolean {
        let isFail: boolean;

        // エンコードオプションチェック
        isFail =
            typeof option.encodeOption !== 'undefined' &&
            this.optionChecker.checkEncodeOption(option.encodeOption) === false;

        // 時刻指定予約なのに timeSpecifiedOption が設定されていない
        if (isEdit === false) {
            isFail =
                isFail ||
                (typeof option.programId === 'undefined' && typeof option.timeSpecifiedOption === 'undefined');
        }

        return !isFail;
    }

    /**
     * `edit`（allowEndLack/saveOption/encodeOptionの変更）を許可してよい手動予約かを判定する。
     * ルール予約（`ruleId`あり。Rule 由来の番組リレー予約を含む）は対象外。手動予約のうち、許可するのは
     * 「番組指定・時刻指定なし・イベントリレーでない」（`programId`のある通常の手動予約）、
     * 「時刻指定・イベントリレー・`programId`なし」（時刻指定の手動予約）、
     * 「番組指定・時刻指定なし・イベントリレー」（手動予約からできた番組リレー予約）の3パターンのみで、
     * それ以外の組み合わせの手動予約は編集を許可しない。
     * @param reserve 判定対象の予約
     * @returns 編集を許可してよいか
     */
    private isEditableManualReserve(reserve: Reserve): boolean {
        const isProgramManual =
            reserve.ruleId === null &&
            reserve.isTimeSpecified === false &&
            reserve.isEventRelay === false &&
            reserve.programId !== null;
        const isTimeManual =
            reserve.ruleId === null &&
            reserve.isTimeSpecified === true &&
            reserve.isEventRelay === true &&
            reserve.programId === null;
        const isManualRelay =
            reserve.ruleId === null &&
            reserve.isTimeSpecified === false &&
            reserve.isEventRelay === true &&
            reserve.programId !== null;

        return isProgramManual || isTimeManual || isManualRelay;
    }

    /**
     * reserve に program の内容をセットする
     * @param reserve: Reserve
     * @param program: Program
     */
    private setProgramToReserve(reserve: Reserve, program: Program | ProgramWithOverlap): void {
        reserve.programId = program.id;
        reserve.programUpdateTime = program.updateTime;
        reserve.channelId = program.channelId;
        reserve.channel = program.channel;
        reserve.channelType = program.channelType;
        reserve.startAt = program.startAt;
        reserve.endAt = program.endAt;
        reserve.name = program.name;
        reserve.shortName = program.shortName;
        reserve.halfWidthName = program.halfWidthName;
        reserve.description = program.description;
        reserve.halfWidthDescription = program.halfWidthDescription;
        reserve.extended = program.extended;
        reserve.halfWidthExtended = program.halfWidthExtended;
        reserve.rawExtended = program.rawExtended;
        reserve.rawHalfWidthExtended = program.rawHalfWidthExtended;
        reserve.genre1 = program.genre1;
        reserve.subGenre1 = program.subGenre1;
        reserve.genre2 = program.genre2;
        reserve.subGenre2 = program.subGenre2;
        reserve.genre3 = program.genre3;
        reserve.subGenre3 = program.subGenre3;
        reserve.videoType = program.videoType;
        reserve.videoResolution = program.videoResolution;
        reserve.videoComponentType = program.videoComponentType;
        reserve.videoStreamContent = program.videoStreamContent;
        reserve.audioSamplingRate = program.audioSamplingRate;
        reserve.audioComponentType = program.audioComponentType;
    }

    /**
     * reserve に saveOption の内容をセットする
     * @param reserve: Reserve
     * @param saveOption: SaveOption
     */
    private setSaveOptionToReserve(reserve: Reserve, saveOption: apid.ReserveSaveOption | undefined): void {
        if (typeof saveOption === 'undefined') {
            reserve.parentDirectoryName = null;
            reserve.directory = null;
            reserve.recordedFormat = null;

            return;
        }

        reserve.parentDirectoryName =
            typeof saveOption.parentDirectoryName === 'undefined' ? null : saveOption.parentDirectoryName;

        reserve.directory = typeof saveOption.directory === 'undefined' ? null : saveOption.directory;

        reserve.recordedFormat = typeof saveOption.recordedFormat === 'undefined' ? null : saveOption.recordedFormat;
    }

    /**
     * reserve に encodeOption の内容をセットする
     * @param reserve: Reserve
     * @param encodeOption: apid.ReserveEncodedOption
     */
    private setEncodeOptionToReserve(reserve: Reserve, encodeOption: apid.ReserveEncodedOption | undefined): void {
        if (typeof encodeOption === 'undefined') {
            reserve.encodeMode1 = null;
            reserve.encodeMode2 = null;
            reserve.encodeMode3 = null;
            reserve.encodeParentDirectoryName1 = null;
            reserve.encodeParentDirectoryName2 = null;
            reserve.encodeParentDirectoryName3 = null;
            reserve.encodeDirectory1 = null;
            reserve.encodeDirectory2 = null;
            reserve.encodeDirectory3 = null;
            reserve.isDeleteOriginalAfterEncode = false;

            return;
        }

        reserve.encodeMode1 = typeof encodeOption.mode1 === 'undefined' ? null : encodeOption.mode1;
        reserve.encodeMode2 = typeof encodeOption.mode2 === 'undefined' ? null : encodeOption.mode2;
        reserve.encodeMode3 = typeof encodeOption.mode3 === 'undefined' ? null : encodeOption.mode3;

        reserve.encodeParentDirectoryName1 =
            typeof encodeOption.encodeParentDirectoryName1 === 'undefined'
                ? null
                : encodeOption.encodeParentDirectoryName1;
        reserve.encodeParentDirectoryName2 =
            typeof encodeOption.encodeParentDirectoryName2 === 'undefined'
                ? null
                : encodeOption.encodeParentDirectoryName2;
        reserve.encodeParentDirectoryName3 =
            typeof encodeOption.encodeParentDirectoryName3 === 'undefined'
                ? null
                : encodeOption.encodeParentDirectoryName3;

        reserve.encodeDirectory1 = typeof encodeOption.directory1 === 'undefined' ? null : encodeOption.directory1;
        reserve.encodeDirectory2 = typeof encodeOption.directory2 === 'undefined' ? null : encodeOption.directory2;
        reserve.encodeDirectory3 = typeof encodeOption.directory3 === 'undefined' ? null : encodeOption.directory3;

        reserve.isDeleteOriginalAfterEncode = encodeOption.isDeleteOriginalAfterEncode;
    }

    /**
     * 手動予約の更新
     */
    public async update(reserveId: apid.ReserveId, isSuppressLog: boolean = false): Promise<void> {
        const exeId = await this.executeManagementModel.getExecution(ReservationManageModel.UPDATE_RESERVE_PRIORITY);
        let diff: IReserveUpdateValues;
        try {
            if (isSuppressLog === false) {
                this.log.system.info(`update reservation: ${reserveId}`);
            }

            // 予約情報を取得する
            const oldReserve = await this.reserveDB.findId(reserveId).catch(err => {
                this.log.system.error(`get reservation error: ${reserveId}`);
                throw err;
            });
            if (oldReserve === null) {
                this.log.system.error(`reservation is not  is not found: ${reserveId}`);
                throw new Error('ReservationIsNotFound');
            }

            // programId 予約か確認する
            if (oldReserve.programId === null) {
                this.log.system.warn(`reservation is not program id reservation: ${reserveId}`);

                return;
            }

            // 番組情報を取得する
            const newProgram = await this.programDB.findId(oldReserve.programId).catch(err => {
                this.log.system.error(`get program error: ${reserveId}`);
                throw err;
            });

            // 番組情報が存在するか確認する
            if (newProgram === null) {
                this.log.system.warn(`program is not found: ${reserveId}`);

                return;
            }

            // 番組情報に更新があったか確認する
            if (oldReserve.programUpdateTime === newProgram.updateTime) {
                if (isSuppressLog === false) {
                    this.log.system.info(`no update reservation: ${reserveId}`);
                }

                return;
            }

            // 予約情報生成
            const newReserve = Object.assign({}, oldReserve);
            this.setProgramToReserve(newReserve, newProgram);
            newReserve.updateTime = oldReserve.updateTime;
            newReserve.isConflict = false;
            newReserve.isEventRelay = oldReserve.isEventRelay;

            // 新旧の予約での差分を生成
            diff = await this.createDiff(
                {
                    times: [
                        {
                            startAt: oldReserve.startAt,
                            endAt: oldReserve.endAt,
                        },
                        {
                            startAt: newReserve.startAt,
                            endAt: newReserve.endAt,
                        },
                    ],
                    hasSkip: false,
                    hasConflict: true,
                    hasOverlap: false,
                    excludeReserveId: reserveId,
                },
                [newReserve],
                [oldReserve],
                isSuppressLog,
            );
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        if (isSuppressLog === false) {
            this.log.system.info(`successful update reservation: ${reserveId}`);
        }

        // イベント発行
        this.reserveEvent.emitUpdated(diff);
    }

    /**
     * ルール変更
     * @param ruleId: rule id
     * @param isSuppressLog ログ出力を抑えるか
     * @param isFirstUpdate: boolean 初回更新か?
     */
    public async updateRule(
        ruleId: apid.RuleId,
        isSuppressLog: boolean = false,
        isFirstUpdate: boolean = false,
    ): Promise<void> {
        const exeId = await this.executeManagementModel.getExecution(
            ReservationManageModel.RULE_UPDATE_RESERVE_PRIORITY,
        );
        let diff: IReserveUpdateValues;
        try {
            if (isSuppressLog === false) {
                this.log.system.info(`update rule reservation: ${ruleId}`);
            }

            // ルールを取得
            const rule = await this.ruleDB.findId(ruleId, true).catch(err => {
                this.log.system.error(`get rule error: ${ruleId}`);
                this.log.system.error(err);
                throw err;
            });

            /**
             * 更新前のルール予約と更新後のルール予約による他の予約の影響を計算する必要があるので、
             * 古いルール予約と新しいルール予約の番組情報を取得し、
             * reserveDB.findTimeRanges で該当する予約を取り出す
             */

            // reserveDB.findTimeRanges で使用するために新旧ルール予約の開始、終了時刻を保存する
            const times: IReserveTimeOption[] = [];

            // 古い予約情報の取り出し
            const oldRuleReserves = await this.reserveDB
                .findRuleId({
                    ruleId: ruleId,
                    hasSkip: true,
                    hasConflict: true,
                    hasOverlap: true,
                    hasEventRelay: false, // イベントリレーの情報は更新対象とさせないため除外
                })
                .catch(err => {
                    this.log.system.error(`find rule reservation error: ${ruleId}`);
                    this.log.system.error(err);
                    throw err;
                });

            // 新しい予約情報検索
            const newRulePrograms =
                rule !== null && rule.reserveOption.enable === true && rule.isTimeSpecification === false
                    ? await this.programDB
                          .findRule({
                              searchOption: rule.searchOption,
                              reserveOption: rule.reserveOption,
                          })
                          .catch(err => {
                              this.log.system.error(`find rule error: ${ruleId}`);
                              this.log.system.error(err);
                              throw err;
                          })
                    : [];

            // 予約情報作成
            const newRuleReserves: Reserve[] = [];
            if (rule !== null && rule.reserveOption.enable === true) {
                // 新しいルール予約情報に skip, overlap の情報をコピーするための索引を作成
                const oldRuleIndex: { [key: string]: Reserve } = {};
                for (const old of oldRuleReserves) {
                    oldRuleIndex[this.createReserveKey(old)] = old;
                }

                const updateTime = new Date().getTime();
                if (rule.isTimeSpecification === true) {
                    // 時刻指定予約
                    if (
                        typeof rule.searchOption.keyword === 'undefined' ||
                        typeof rule.searchOption.channelIds === 'undefined' ||
                        typeof rule.searchOption.times === 'undefined'
                    ) {
                        this.log.system.error(`rule search option error: ${ruleId}`);
                        throw new Error('RuleSearchOptionError');
                    }

                    // times 準備
                    const baseTime = new Date(DateUtil.format(new Date(), 'yyyy/MM/dd 00:00:00 +0900')).getTime();
                    for (const time of rule.searchOption.times) {
                        if (typeof time.start === 'undefined' || typeof time.range === 'undefined') {
                            throw new Error('RuleSearchTimesOptionError');
                        }

                        // 曜日情報
                        const weeks: boolean[] = [
                            (time.week & 0x01) !== 0, // 日
                            (time.week & 0x02) !== 0, // 月
                            (time.week & 0x04) !== 0, // 火
                            (time.week & 0x08) !== 0, // 水
                            (time.week & 0x10) !== 0, // 木
                            (time.week & 0x20) !== 0, // 金
                            (time.week & 0x40) !== 0, // 土
                        ];

                        for (let i = 0; i < 8; i++) {
                            // 1 週間分の予約情報を作成する
                            const startAt = baseTime + 1000 * 60 * 60 * 24 * i + time.start * 1000;
                            const endAt = baseTime + 1000 * 60 * 60 * 24 * i + (time.start + time.range) * 1000;

                            if (endAt < updateTime || weeks[new Date(startAt).getDay()] === false) {
                                // 終了時刻が現在時刻より古い or 有効な曜日ではない
                                continue;
                            }

                            // 予約情報検索のために時刻位置取得
                            times.push({
                                startAt: startAt,
                                endAt: endAt,
                            });
                        }
                    }

                    for (const channelId of rule.searchOption.channelIds) {
                        // channelId
                        let channel: Channel | null;
                        try {
                            channel = await this.channelDB.findId(channelId);
                        } catch (err: any) {
                            this.log.system.error(`get channel id error: ${channelId}`);
                            continue;
                        }
                        if (channel === null) {
                            this.log.system.error(`channel id is not found: ${channelId}`);
                            continue;
                        }

                        // times の分だけ予約情報を生成する
                        for (const time of times) {
                            // 予約情報セット
                            const newReserve = new Reserve();
                            newReserve.isTimeSpecified = true;
                            newReserve.name = StrUtil.toDBStr(rule.searchOption.keyword);
                            newReserve.halfWidthName = StrUtil.toHalf(newReserve.name);
                            newReserve.updateTime = updateTime;
                            newReserve.startAt = time.startAt;
                            newReserve.endAt = time.endAt;
                            newReserve.channelId = channelId;
                            newReserve.channel = channel.channel;
                            newReserve.channelType = channel.channelType;
                            this.setProgramToRuleReserve(newReserve, null, <RuleWithCnt>rule, updateTime);

                            // skip, overlap コピー
                            const oldReserve = oldRuleIndex[this.createReserveKey(newReserve)];
                            if (typeof oldReserve !== 'undefined') {
                                newReserve.isSkip = oldReserve.isSkip;
                                newReserve.isIgnoreOverlap = oldReserve.isIgnoreOverlap;
                                newReserve.isOverlap = oldReserve.isOverlap;
                            }

                            newRuleReserves.push(newReserve);
                        }
                    }
                } else if (newRulePrograms.length !== 0) {
                    // 新しいルールに一致する予約情報があった
                    for (const program of newRulePrograms) {
                        const newReserve = new Reserve();
                        // 予約情報追加
                        this.setProgramToRuleReserve(newReserve, program, <RuleWithCnt>rule, updateTime);

                        // skip, overlap 情報をコピー
                        const oldReserve = oldRuleIndex[this.createReserveKey(newReserve)];
                        if (typeof oldReserve !== 'undefined') {
                            newReserve.isSkip = oldReserve.isSkip;
                            newReserve.isIgnoreOverlap = oldReserve.isIgnoreOverlap;
                            // isIgnoreOverlap が有効な場合はプログラム検索の重複結果ではなく予約の重複結果をコピーする
                            newReserve.isOverlap =
                                oldReserve.isIgnoreOverlap === true ? oldReserve.isOverlap : program.overlap;
                        }
                        newRuleReserves.push(newReserve);

                        // 予約情報検索のために時刻位置取得
                        times.push({
                            startAt: program.startAt,
                            endAt: program.endAt,
                        });
                    }
                }
            }

            // 古いルール予約の時刻位置取得
            for (const reserve of oldRuleReserves) {
                times.push({ startAt: reserve.startAt, endAt: reserve.endAt });
            }

            // 初回更新かつ時刻指定予約である場合は
            // createDiff 実行時に差分を出して録画タイマーを生成するように強制する
            if (isFirstUpdate === true && rule?.isTimeSpecification === true) {
                for (const r of oldRuleReserves) {
                    r.ruleUpdateCnt = -1; // ruleUpdateCnt は 0 以上しか存在しないので強制的に差分となる
                }
            }

            // 新旧の予約での差分を生成
            diff = await this.createDiff(
                {
                    times: times,
                    hasSkip: true,
                    hasConflict: true,
                    hasOverlap: true, // 除外と重複が併存する他のルールの予約も番組単位の除外の判定に使う
                    excludeRuleId: ruleId, // ruleId 指定で古いルール予約は除外する
                },
                newRuleReserves,
                oldRuleReserves,
                isSuppressLog,
            );
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        if (isSuppressLog === false) {
            this.log.system.info(`successful update rule reservation: ${ruleId}`);
        }

        // イベント発行
        this.reserveEvent.emitUpdated(diff);
    }

    /**
     * reserve に 番組情報とルール情報をセットする
     * @param reserve: Reserve
     * @param program: ProgramWithOverlap | null
     * @param rule: RuleWithCnt
     * @param updateTime: apid.UnixtimeMS
     */
    private setProgramToRuleReserve(
        reserve: Reserve,
        program: ProgramWithOverlap | null,
        rule: RuleWithCnt,
        updateTime: apid.UnixtimeMS,
    ): void {
        reserve.ruleId = rule.id;
        reserve.ruleUpdateCnt = rule.updateCnt;
        reserve.updateTime = updateTime;
        reserve.allowEndLack = rule.reserveOption.allowEndLack;

        if (typeof rule.reserveOption.tags !== 'undefined') {
            reserve.tags = JSON.stringify(rule.reserveOption.tags);
        }

        if (program !== null) {
            reserve.isOverlap = program.overlap;
            this.setProgramToReserve(reserve, program);
        }

        if (typeof rule.saveOption !== 'undefined') {
            this.setSaveOptionToReserve(reserve, rule.saveOption);
        }

        if (typeof rule.encodeOption !== 'undefined') {
            this.setEncodeOptionToReserve(reserve, rule.encodeOption);
        }
    }

    /**
     * 新旧の予約の差分を生成 & DB へ適応する
     * @param findOption :IFindTimeRangesOption
     * @param addNewReserves: 新規追加する予約
     * @param addOldReserves: 旧のみに含まれる予約
     * @param isSuppressLog: ログ出力を抑えるか
     * @return IReserveUpdateValues
     */
    private async createDiff(
        findOption: IFindTimeRangesOption,
        addNewReserves: Reserve[],
        addOldReserves: Reserve[],
        isSuppressLog: boolean,
    ): Promise<IReserveUpdateValues> {
        // 影響を受ける可能性のある予約を取り出す
        const baseReserves = await this.reserveDB.findTimeRanges(findOption).catch(err => {
            this.log.system.error('reserve get error');
            throw err;
        });

        let newReserves = this.copyReserveArray(addNewReserves);
        // baseReserves を破壊しないように copyReserveArray で deep copy する
        Array.prototype.push.apply(newReserves, this.copyReserveArray(baseReserves));

        // 予約情報を計算
        newReserves = this.createReserves(newReserves);

        // 古い予約情報と差分を列挙する
        const oldReserves = this.copyReserveArray(addOldReserves);
        // baseReserves を破壊しないように copyReserveArray で deep copy する
        Array.prototype.push.apply(oldReserves, this.copyReserveArray(baseReserves));

        // oldReserves と newReserves の差分を列挙
        const diff = this.createReservesDiff(oldReserves, newReserves, isSuppressLog);

        if (isSuppressLog === false) {
            this.log.system.info({
                insert: typeof diff.insert === 'undefined' ? 0 : diff.insert.length,
                update: typeof diff.update === 'undefined' ? 0 : diff.update.length,
                delete: typeof diff.delete === 'undefined' ? 0 : diff.delete.length,
            });
        }

        // 列挙した予約情報を DB へ反映させる
        await this.reserveDB.updateMany(diff).catch(err => {
            this.log.system.error('reserves update many error');
            throw err;
        });

        return diff;
    }

    /**
     * Reserve[] をコピーする
     * @param src: Reserve[]
     * @return Reserve[]
     */
    private copyReserveArray(src: Reserve[]): Reserve[] {
        const newReserves: Reserve[] = [];

        for (const reserve of src) {
            newReserves.push(Object.assign({}, reserve));
        }

        return newReserves;
    }

    /**
     * 予約情報の差分作成
     * 時刻指定手動予約は状態差分だけを、Rule 時刻予約は更新回数を含めてチェックする
     * @param oldReserves: Reserve[]
     * @param newReserves: Reserve[]
     * @param isSuppressLog: boolean ログ出力を抑えるか
     * @return IReserveUpdateValues
     */
    private createReservesDiff(
        oldReserves: Reserve[],
        newReserves: Reserve[],
        isSuppressLog: boolean,
    ): IReserveUpdateValues {
        const diff: IReserveUpdateValues = {
            isSuppressLog: isSuppressLog,
        };

        diff.insert = [];
        diff.update = [];
        diff.delete = [];

        // 検索用のインデックスを作成
        const idIndex: { [key: string]: ReserveDiffData } = {}; // program id
        const timeIndex: { [key: string]: ReserveDiffData } = {}; // 時刻指定予約
        for (const reserve of oldReserves) {
            if (reserve.programId === null) {
                timeIndex[this.createReserveKey(reserve)] = {
                    reserve: reserve,
                    isChecked: false,
                };
            } else {
                idIndex[this.createReserveKey(reserve)] = {
                    reserve: reserve,
                    isChecked: false,
                };
            }
        }

        // 差分チェック
        for (const newReserve of newReserves) {
            const key = this.createReserveKey(newReserve);
            if (typeof idIndex[key] !== 'undefined') {
                idIndex[key].isChecked = true;
                const oldReserve = idIndex[key].reserve;
                // oldReserve と差分をチェック
                if (this.checkProgramIdReserveDiff(oldReserve, newReserve)) {
                    // update のために reserve id をコピーする
                    newReserve.id = oldReserve.id;
                    diff.update.push(newReserve);
                }
            } else if (typeof timeIndex[key] !== 'undefined') {
                timeIndex[key].isChecked = true;
                const oldReserve = timeIndex[key].reserve;
                // oldReserve と差分をチェック
                if (this.checkTimeRuleReserveDiff(oldReserve, newReserve)) {
                    // update のために reserve id をコピーする
                    newReserve.id = oldReserve.id;
                    diff.update.push(newReserve);
                }
            } else {
                // 新規追加予約情報
                diff.insert.push(newReserve);
            }
        }

        // 削除する予約を追加
        for (const key in idIndex) {
            if (idIndex[key].isChecked === false) {
                diff.delete.push(idIndex[key].reserve);
            }
        }
        for (const key in timeIndex) {
            if (timeIndex[key].isChecked === false) {
                diff.delete.push(timeIndex[key].reserve);
            }
        }

        return diff;
    }

    /**
     * 予約情報から固有の key を作成する
     * @param reserve: Reserve
     * @return string
     */
    private createReserveKey(reserve: Reserve): string {
        return (
            (reserve.programId === null
                ? `${reserve.startAt}-${reserve.endAt}-${reserve.channel}`
                : `${reserve.programId}`) + `-${reserve.ruleId}`
        );
    }

    /**
     * program id のある予約に差分があるかチェック
     * @param oldReserves: Reserve
     * @param newReserve: Reserve
     * @return boolean 差分があれば true
     */
    private checkProgramIdReserveDiff(oldReserve: Reserve, newReserve: Reserve): boolean {
        return (
            oldReserve.programId === newReserve.programId &&
            (oldReserve.programUpdateTime !== newReserve.programUpdateTime ||
                oldReserve.ruleUpdateCnt !== newReserve.ruleUpdateCnt ||
                oldReserve.isSkip !== newReserve.isSkip ||
                oldReserve.isConflict !== newReserve.isConflict ||
                oldReserve.isOverlap !== newReserve.isOverlap)
        );
    }

    /**
     * 時刻指定予約の状態差分と Rule 時刻予約の更新回数差分をチェック
     * @param oldReserve: Reserve
     * @param newReserve: Reserve
     * @return boolean 差分があれば true
     */
    private checkTimeRuleReserveDiff(oldReserve: Reserve, newReserve: Reserve): boolean {
        return (
            (oldReserve.ruleId !== null &&
                newReserve.ruleId !== null &&
                oldReserve.ruleUpdateCnt !== newReserve.ruleUpdateCnt) ||
            oldReserve.isSkip !== newReserve.isSkip ||
            oldReserve.isConflict !== newReserve.isConflict ||
            oldReserve.isOverlap !== newReserve.isOverlap
        );
    }

    /**
     * 全ての予約情報の更新
     * @param isFirstUpdate: boolean 初回更新か
     */
    public async updateAll(isFirstUpdate: boolean = false): Promise<void> {
        this.log.system.info('all reservation update start');

        const isSuppressLog = this.config.isSuppressReservesUpdateAllLog;

        // 手動予約 (program id) の id を取得
        const manualIds = await this.reserveDB.getManualIds({ hasTimeReserve: false }).catch(err => {
            this.log.system.error('get manual reservation ids error');
            throw err;
        });

        // ルール予約によってイベントリレーで予約された予約の id を取得
        const ruleEventRelayIds = await this.reserveDB.getRuleEventRelayIds().catch(err => {
            this.log.system.error('get rule event relay ids error');
            throw err;
        });

        // ルールの id を取得
        const ruleIds = await this.ruleDB.getIds().catch(err => {
            this.log.system.error('get rule ids error');
            throw err;
        });

        // 手動予約更新
        for (const manualId of manualIds) {
            await this.update(manualId, isSuppressLog).catch(err => {
                this.log.system.error(err);
            });
            await Util.sleep(10);
        }

        // ルール予約によってイベントリレーで予約された予約の更新
        for (const manualId of ruleEventRelayIds) {
            await this.update(manualId, isSuppressLog).catch(err => {
                this.log.system.error(err);
            });
            await Util.sleep(10);
        }

        // ルール予約更新
        for (const ruleId of ruleIds) {
            await this.updateRule(ruleId, isSuppressLog, isFirstUpdate).catch(err => {
                this.log.system.error(err);
            });
            await Util.sleep(10);
        }

        const exeId = await this.executeManagementModel.getExecution(ReservationManageModel.UPDATE_RESERVE_PRIORITY);
        let diff: IReserveUpdateValues;
        try {
            const reserves = await this.reserveDB.findLists();
            const candidates = reserves.filter(reserve => reserve.isSkip === false && reserve.isOverlap === false);
            const preserved = reserves.filter(reserve => reserve.isSkip || reserve.isOverlap);
            diff = await this.createConflictSweepDiff(reserves, candidates, preserved, isSuppressLog);

            if (isFirstUpdate) {
                const candidateSnapshot = await this.reserveDB.findLists();
                // 録画側が録画候補と時刻指定予約の timer を組み直すために、保存済みの全予約を update として送り直す。
                // 予約の変更ではないので、外部 command には渡さないよう印を付ける。
                diff = {
                    ...diff,
                    update: candidateSnapshot,
                    isStartupRebuild: true,
                };
            }
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        this.reserveEvent.emitUpdated(diff!);

        this.log.system.info('all reservation update finish');
    }

    /**
     * 予約キャンセル
     * 手動予約の場合は削除
     * ルール予約の場合は除外
     * @param reserveId 予約 ID
     */
    public async cancel(reserveId: apid.ReserveId): Promise<void> {
        const exeId = await this.executeManagementModel.getExecution(ReservationManageModel.CANCEL_RESERVE_PRIORITY);
        let diff: IReserveUpdateValues;
        try {
            this.log.system.info(`cancel reservation: ${reserveId}`);

            // reserveId が存在するかチェック
            const cancelReserve = await this.reserveDB.findId(reserveId).catch(err => {
                this.log.system.error(`get reservation error: ${reserveId}`);
                throw err;
            });

            if (cancelReserve === null) {
                this.log.system.error(`reservation is not found: ${reserveId}`);
                throw new Error('ReservationIsNotFound');
            }

            const oldReserves: Reserve[] = [Object.assign({}, cancelReserve)];

            // 比較のために新しい予約情報を生成
            const newReserves: Reserve[] = [];
            if (cancelReserve.ruleId !== null && cancelReserve.isEventRelay === false) {
                // ルール予約の場合
                if (cancelReserve.isOverlap === true) {
                    // overlap
                    cancelReserve.isIgnoreOverlap = false;
                    cancelReserve.isOverlap = true;
                } else {
                    // skip
                    cancelReserve.isSkip = true;
                }
                // skip or overlap している場合は競合しない
                cancelReserve.isConflict = false;

                // 新しい予約情報に追加
                newReserves.push(cancelReserve);
            }

            // 新旧の予約での差分を生成
            diff = await this.createDiff(
                {
                    times: [
                        {
                            startAt: cancelReserve.startAt,
                            endAt: cancelReserve.endAt,
                        },
                    ],
                    hasSkip: false,
                    hasConflict: true,
                    hasOverlap: true, // 除外にした番組の他のルールの重複状態の予約も同じ差分で削除する
                    excludeReserveId: reserveId,
                },
                newReserves,
                oldReserves,
                false,
            );
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        this.log.system.info(`successful cancel reservation: ${reserveId}`);

        // イベント発行
        this.reserveEvent.emitUpdated(diff);
    }

    /**
     * skip の解除
     * @param reserveId: reserve id
     */
    public async removeSkip(reserveId: apid.ReserveId): Promise<void> {
        const exeId = await this.executeManagementModel.getExecution(
            ReservationManageModel.REMOVE_SKIP_RESERVE_PRIORITY,
        );
        let diff: IReserveUpdateValues;
        try {
            this.log.system.info(`remove skip reservation: ${reserveId}`);

            // reserveId が存在するかチェック
            const oldReserve = await this.reserveDB.findId(reserveId).catch(err => {
                this.log.system.error(`get reservation error: ${reserveId}`);
                throw err;
            });
            if (oldReserve === null) {
                this.log.system.error(`reservation is not found: ${reserveId}`);
                throw new Error('ReservationIsNotFound');
            }

            // ルール予約かチェック
            if (oldReserve.ruleId === null || oldReserve.isEventRelay === true) {
                this.log.system.warn(`reservation is not rule reservation: ${reserveId}`);

                return;
            }

            // skip が有効化チェック
            if (oldReserve.isSkip !== true) {
                this.log.system.warn(`reservation is not skiped: ${reserveId}`);

                return;
            }

            // skip を解除した予約を作成
            const newReserve: Reserve = Object.assign({}, oldReserve);
            newReserve.isSkip = false;
            const newReserves: Reserve[] = [newReserve];
            const oldReserves: Reserve[] = [oldReserve];

            // 除外は番組単位なので、同じ番組の他のルールの除外も一緒に解除する
            if (oldReserve.programId !== null) {
                const sameProgramReserves = await this.reserveDB.findProgramId(oldReserve.programId).catch(err => {
                    this.log.system.error(`get program reservation error: ${reserveId}`);
                    throw err;
                });
                for (const other of sameProgramReserves) {
                    if (
                        other.id !== reserveId &&
                        other.ruleId !== null &&
                        other.isEventRelay === false &&
                        other.isSkip === true
                    ) {
                        oldReserves.push(other);
                        newReserves.push(Object.assign({}, other, { isSkip: false }));
                    }
                }
            }

            diff = await this.createDiff(
                {
                    times: [
                        {
                            startAt: oldReserve.startAt,
                            endAt: oldReserve.endAt,
                        },
                    ],
                    hasSkip: false,
                    hasConflict: true,
                    hasOverlap: false,
                    excludeReserveId: reserveId,
                },
                newReserves,
                oldReserves,
                false,
            );
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        this.log.system.info(`successful remove skip reservation: ${reserveId}`);

        // イベント発行
        this.reserveEvent.emitUpdated(diff);
    }

    /**
     * overlap の解除
     * @param reserveId: reserve id
     * @return Promise<void>
     */
    public async removeOverlap(reserveId: apid.ReserveId): Promise<void> {
        const exeId = await this.executeManagementModel.getExecution(
            ReservationManageModel.REMOVE_OVERLAP_RESERVE_PRIORITY,
        );
        let diff: IReserveUpdateValues;
        try {
            this.log.system.info(`remove overlap reservation: ${reserveId}`);

            // reserveId が存在するかチェック
            const oldReserve = await this.reserveDB.findId(reserveId).catch(err => {
                this.log.system.error(`get reservation error: ${reserveId}`);
                throw err;
            });
            if (oldReserve === null) {
                this.log.system.error(`reservation is not found: ${reserveId}`);
                throw new Error('ReservationIsNotFound');
            }

            // ルール予約かチェック
            if (oldReserve.ruleId === null || oldReserve.isEventRelay === true) {
                this.log.system.warn(`reservation is not rule reservation: ${reserveId}`);

                return;
            }

            // overlap が解除されていないかチェック
            if (oldReserve.isIgnoreOverlap === true && oldReserve.isOverlap === false) {
                this.log.system.warn(`reservation is removed overlap: ${reserveId}`);

                return;
            }

            // overlap を解除した予約を作成
            const newReserves: Reserve = Object.assign({}, oldReserve);
            newReserves.isIgnoreOverlap = true;
            newReserves.isOverlap = false;

            diff = await this.createDiff(
                {
                    times: [
                        {
                            startAt: oldReserve.startAt,
                            endAt: oldReserve.endAt,
                        },
                    ],
                    hasSkip: false,
                    hasConflict: true,
                    hasOverlap: false,
                    excludeReserveId: reserveId,
                },
                [newReserves],
                [oldReserve],
                false,
            );
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        this.log.system.info(`successful remove overlap reservation: ${reserveId}`);

        // イベント発行
        this.reserveEvent.emitUpdated(diff);
    }

    /**
     * 手動予約の編集
     * allowEndLack, saveOption, encodeOption を更新する
     * @param reserveId: reserve id
     * @param option: apid.EditManualReserveOption
     */
    public async edit(reserveId: apid.ReserveId, option: apid.EditManualReserveOption): Promise<void> {
        // 保存先の外を指すディレクトリは受け付けない
        this.checkSubDirectories(option);

        // オプションチェック
        if (this.checkManualReserveOption(option, true) === false) {
            this.log.system.error('edit reservation option error');
            throw new Error('ReservationEditError');
        }

        let newReserve: Reserve;
        const exeId = await this.executeManagementModel.getExecution(ReservationManageModel.EDIT_RESERVE_PRIORITY);
        try {
            this.log.system.info(`edit reservation: ${reserveId}`);

            // reserveId が存在するかチェック
            const reserve = await this.reserveDB.findId(reserveId).catch(err => {
                this.log.system.error(`get reservation error: ${reserveId}`);
                throw err;
            });
            if (reserve === null) {
                this.log.system.error(`reservation is not found: ${reserveId}`);
                throw new Error('ReservationIsNotFound');
            }

            if (this.isEditableManualReserve(reserve) === false) {
                this.log.system.error(`reservation is not editable manual reservation: ${reserveId}`);
                throw new Error(RESERVATION_NOT_EDITABLE_ERROR);
            }

            // option から必要な情報をセットする
            reserve.updateTime = new Date().getTime();
            reserve.allowEndLack = option.allowEndLack;
            if (typeof option.tags !== 'undefined') {
                reserve.tags = JSON.stringify(option.tags);
            }
            this.setSaveOptionToReserve(reserve, option.saveOption);
            this.setEncodeOptionToReserve(reserve, option.encodeOption);

            // 更新
            await this.reserveDB.updateOnce(reserve).catch(err => {
                this.log.system.error(`update reservation error: ${reserveId}`);
                throw err;
            });
            newReserve = reserve;
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        this.log.system.info(`successful edit reservation: ${reserveId}`);

        // イベント発行
        this.reserveEvent.emitUpdated({
            update: [newReserve],
            isSuppressLog: false,
        });
    }

    /**
     * 現在時刻より古い予約を削除する
     */
    public async cleanup(): Promise<void> {
        const exeId = await this.executeManagementModel.getExecution(ReservationManageModel.EDIT_RESERVE_PRIORITY);
        let diff: IReserveUpdateValues;
        try {
            this.log.system.info('start reserves cleanup');

            // 古い予約を取得する
            const deleteReserves = await this.reserveDB.findOldTime(new Date().getTime()).catch(err => {
                this.log.system.error('get delete old reservation error');
                throw err;
            });
            try {
                const pendingRanges = new Map<number, { startAt: number; endAt: number }>(
                    deleteReserves.map(reserve => [reserve.id, { startAt: reserve.startAt, endAt: reserve.endAt }]),
                );
                const survivors = new Map<number, Reserve>();
                for (const range of pendingRanges.values()) {
                    const candidates = await this.reserveDB.findTimeRanges({
                        times: [range],
                        hasSkip: false,
                        hasConflict: true,
                        hasOverlap: false,
                    });
                    for (const candidate of candidates) {
                        if (pendingRanges.has(candidate.id)) {
                            continue;
                        }
                        pendingRanges.set(candidate.id, { startAt: candidate.startAt, endAt: candidate.endAt });
                        survivors.set(candidate.id, candidate);
                    }
                }
                const survivorValues = [...survivors.values()];
                diff = await this.createConflictSweepDiff(
                    [...deleteReserves, ...survivorValues],
                    survivorValues,
                    [],
                    false,
                );
            } catch (err) {
                this.log.system.error('delete old reservation error');
                throw err;
            }
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        this.log.system.info('finish reserves cleanup');

        // イベント発行
        this.reserveEvent.emitUpdated(diff!);
    }

    /**
     * `candidates`（skip/overlapでない、競合判定の対象となる予約）に対して`createReserves`
     * （平面走査法での重複・競合再判定）を再実行し、その結果と`preserved`（skip/overlapのまま
     * 変更しない予約）を合わせた全体を新しい予約集合として、`oldReserves`との差分をDBへ反映する。
     * `updateAll`（全体再計算）と`cleanup`（期限切れ予約削除後、それに伴って空いた枠で
     * 他の予約の競合状態が変わりうる場合の再計算）の両方から使われる。
     * @param oldReserves 差分計算の比較元となる、更新前の予約一覧
     * @param candidates 競合再判定の対象にする予約
     * @param preserved 競合再判定をせず、そのまま結果に含める予約（skip/overlap等）
     * @param isSuppressLog 差分適用時のログ出力を抑えるか
     * @returns DBへ反映した差分
     */
    private async createConflictSweepDiff(
        oldReserves: Reserve[],
        candidates: Reserve[],
        preserved: Reserve[],
        isSuppressLog: boolean,
    ): Promise<IReserveUpdateValues> {
        const recalculated = this.createReserves(this.copyReserveArray(candidates));
        Array.prototype.push.apply(recalculated, this.copyReserveArray(preserved));
        const diff = this.createReservesDiff(oldReserves, recalculated, isSuppressLog);

        await this.reserveDB.updateMany(diff);

        return diff;
    }

    /**
     * 予約情報を生成する
     * 平面走査法のような事をしている
     * いずれかのルールの予約が除外されている番組は、他のルールの予約（重複状態を含む）を作らない（除外は番組単位）
     * @param allMatches 予約したい番組情報
     * @return Reserve[] 予約情報
     */
    private createReserves(allMatches: Reserve[]): Reserve[] {
        // いずれかのルールの予約が除外されている番組は、他のルールの予約（重複状態を含む）を作らない
        const skippedProgramIds = new Set<number>();
        for (const reserve of allMatches) {
            if (
                reserve.ruleId !== null &&
                reserve.programId !== null &&
                reserve.isEventRelay === false &&
                reserve.isSkip
            ) {
                skippedProgramIds.add(reserve.programId);
            }
        }
        const matches = allMatches.filter(
            reserve =>
                reserve.ruleId === null ||
                reserve.programId === null ||
                reserve.isEventRelay ||
                reserve.isSkip ||
                !skippedProgramIds.has(reserve.programId),
        );

        // 重複チェックのために programId でソート
        matches.sort(this.sortReserve);

        const list: {
            time: apid.UnixtimeMS;
            isStart: boolean;
            idx: number; // matches index
        }[] = [];

        // 重複チェック用 index
        const programIdIndex: { [key: string]: boolean } = {};

        // list を生成
        for (let i = 0; i < matches.length; i++) {
            // programId 予約における重複を検知するためのキーを生成する
            const matchProgramIdKey = this.getRuleProgramIdKey(matches[i]);

            if (matchProgramIdKey !== null) {
                // programId がすでに存在する場合は list に追加しない
                if (typeof programIdIndex[matchProgramIdKey] === 'undefined') {
                    programIdIndex[matchProgramIdKey] = true;
                } else {
                    continue;
                }
            }

            list.push({
                time: matches[i].startAt,
                isStart: true,
                idx: i,
            });
            list.push({
                time: matches[i].endAt,
                isStart: false,
                idx: i,
            });
        }

        // list を ソート
        list.sort((a, b) => {
            const time = a.time - b.time;

            if (time !== 0) {
                return time;
            } else if (a.isStart && !b.isStart) {
                return 1;
            } else if (!a.isStart && b.isStart) {
                return -1;
            } else {
                return a.idx - b.idx;
            }
        });

        // 予約情報が格納可能かチェックする
        const conflictResults: { [key: number]: boolean } = {}; // 重複の評価結果の格納先
        const reserves: { reserve: Reserve; idx: number }[] = []; // 時間帯が重複する番組情報の格納先
        for (const l of list) {
            if (matches[l.idx].isSkip) {
                continue;
            }

            if (l.isStart) {
                // add
                reserves.push({ reserve: matches[l.idx], idx: l.idx });
            } else {
                // remove
                const index = reserves.findIndex(r => {
                    return r.idx === l.idx;
                });
                reserves.splice(index, 1);
            }

            // sort reserves
            reserves.sort((a, b) => {
                return this.sortReserve(a.reserve, b.reserve);
            });

            this.log.system.debug('--------------------');
            for (const r of reserves) {
                this.log.system.debug(<any>{
                    name: r.reserve.name,
                    ruleId: r.reserve.ruleId,
                });
            }

            // tuner clear
            for (let i = 0; i < this.tuners.length; i++) {
                this.tuners[i].clear();
            }

            // 重複の評価
            for (const reserve of reserves) {
                if (matches[reserve.idx].isSkip || matches[reserve.idx].isOverlap) {
                    continue;
                }

                let isConflict = true;
                for (let i = 0; i < this.tuners.length; i++) {
                    if (this.tuners[i].add(matches[reserve.idx])) {
                        isConflict = false;
                        break;
                    }
                }

                // 重複したか？
                if (isConflict) {
                    conflictResults[reserve.idx] = true;
                }
            }
        }

        // list から重複を除外した予約情報を生成
        const newReserves: Reserve[] = [];
        for (const l of list) {
            if (l.isStart) {
                // matches の破損防止のために予約情報のコピーする
                const newReserve: Reserve = Object.assign({}, matches[l.idx]);
                // 重複の評価結果の反映
                newReserve.isConflict = conflictResults[l.idx] === true;
                // 予約情報 の格納
                newReserves.push(newReserve);
            }
        }

        return newReserves.sort((a, b) => {
            return a.startAt - b.startAt;
        });
    }

    /**
     * Reserve のソート用関数
     * 時刻指定予約 > 手動予約 > ルール予約
     * manualId が小さい > manualId が大きい > ruleId が小さい > ruleId が大きい の順で判定する
     * @param a: Reserve
     * @param b: Reserve
     * @return number
     */
    private sortReserve(a: Reserve, b: Reserve): number {
        const aIsManual = a.ruleId === null;
        const bIsManual = b.ruleId === null;

        if (aIsManual && bIsManual) {
            if (a.isTimeSpecified === b.isTimeSpecified) {
                return a.updateTime - b.updateTime;
            } else {
                return a.isTimeSpecified && !b.isTimeSpecified ? -1 : 1;
            }
        }
        if (aIsManual && !bIsManual) {
            return -1; // // 手動予約を優先
        }
        if (!aIsManual && bIsManual) {
            return 1; // // 手動予約を優先
        }
        if (!aIsManual && !bIsManual && a.ruleId !== null && b.ruleId !== null) {
            return a.ruleId - b.ruleId;
        }

        return 0;
    }

    /**
     * 予約の ProgramId の重複検知するための key を生成する
     * @param re: reserve
     * @returns string | null programId 予約でない場合は null を返す
     */
    private getRuleProgramIdKey(re: Reserve): string | null {
        // programId 予約ではない
        if (re.programId === null) {
            return null;
        }

        // 非ルール予約であれば ProgramId を返す
        if (re.ruleId === null) {
            return re.programId.toString(10);
        }

        // 除外または重複のルール予約は、ルールごとの利用者の操作・状態の記録なので、他のルールの同じ状態と畳み込まない
        if (re.isSkip || re.isOverlap) {
            return `${re.programId.toString(10)}-${re.isSkip ? 'skip' : 'overlap'}-${re.ruleId}`;
        }

        // そうでなければ ProgramId に競合、重複情報を追加して返す
        return `${re.programId.toString(10)}-${re.isConflict}-${re.isOverlap}-${re.isSkip}`;
    }
}

namespace ReservationManageModel {
    export const ADD_RESERVE_PRIORITY = 1;
    export const UPDATE_RESERVE_PRIORITY = 1;
    export const RULE_UPDATE_RESERVE_PRIORITY = 1;
    export const CANCEL_RESERVE_PRIORITY = 2;
    export const REMOVE_SKIP_RESERVE_PRIORITY = 2;
    export const REMOVE_OVERLAP_RESERVE_PRIORITY = 2;
    export const EDIT_RESERVE_PRIORITY = 2;
}

export default ReservationManageModel;
declare const __EPGSTATION_COVERAGE_EXCLUSION_RESERVATION_MANAGE_DIFF_LOG_AND_SORT_20260924: unique symbol;
