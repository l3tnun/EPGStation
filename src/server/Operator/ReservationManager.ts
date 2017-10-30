import * as path from 'path';
import * as fs from 'fs';
import * as events from 'events'
import Base from '../Base';
import * as apid from '../../../node_modules/mirakurun/api';
import Tuner from './Tuner';
import { SearchInterface, OptionInterface, EncodeInterface } from './RuleInterface';
import { ProgramsDBInterface } from '../Model/DB/ProgramsDB';
import { IPCServerInterface } from '../Model/IPC/IPCServer';
import { RulesDBInterface } from '../Model/DB/RulesDB';
import * as DBSchema from '../Model/DB/DBSchema';
import { ReserveProgram } from './ReserveProgramInterface';
import Util from '../Util/Util';
import DateUtil from '../Util/DateUtil';
import CheckRule from '../Util/CheckRule';

interface ExeQueueData {
    id: string;
    priority: number;
}

interface ReserveAllId {
    reserves: ReserveAllItem[],
    conflicts: ReserveAllItem[],
    skips: ReserveAllItem[],
}

interface ReserveAllItem {
    programId: number,
    ruleId?: number,
}

interface ReserveLimit {
    reserves: ReserveProgram[];
    total: number;
}

interface ReservationManagerInterface {
    setTuners(tuners: apid.TunerDevice[]): void;
    getReserve(programId: apid.ProgramId): ReserveProgram | null;
    getReservesAll(limit?: number, offset?: number): ReserveProgram[];
    getReservesAllId(): ReserveAllId;
    getReserves(limit?: number, offset?: number): ReserveLimit;
    getConflicts(limit?: number, offset?: number): ReserveLimit;
    getSkips(limit?: number, offset?: number): ReserveLimit;
    cancel(id: apid.ProgramId): void;
    removeSkip(id: apid.ProgramId): Promise<void>;
    addReserve(programId: apid.ProgramId, encode?: EncodeInterface): Promise<void>;
    updateAll(): Promise<void>;
    updateRule(ruleId: number): Promise<void>;
    clean(): void;
}

/**
* ReservationManager
* 予約の管理を行う
* @throws ReservationManagerCreateError init を呼ばないと起こる
*/
class ReservationManager extends Base {
    private static instance: ReservationManager;
    private static inited: boolean = false;

    private lockId: string | null = null;
    private exeQueue: ExeQueueData[] = [];
    private exeEventEmitter: events.EventEmitter = new events.EventEmitter();

    private programDB: ProgramsDBInterface;
    private rulesDB: RulesDBInterface;
    private ipc: IPCServerInterface;
    private reserves: ReserveProgram[] = []; //予約
    private tuners: Tuner[] = [];
    private reservesPath: string;

    public static init(programDB: ProgramsDBInterface, rulesDB: RulesDBInterface, ipc: IPCServerInterface) {
        if(ReservationManager.inited) { return; }
        ReservationManager.inited = true;
        this.instance = new ReservationManager(programDB, rulesDB, ipc);
        ReservationManager.inited = true;
    }

    public static getInstance(): ReservationManager {
        if(!ReservationManager.inited) {
            throw new Error('ReservationManagerCreateError');
        }

        return this.instance;
    }

    private constructor(programDB: ProgramsDBInterface, rulesDB: RulesDBInterface, ipc: IPCServerInterface) {
        super();
        this.programDB = programDB;
        this.rulesDB = rulesDB;
        this.ipc = ipc;
        this.reservesPath = this.config.getConfig().reserves || path.join(__dirname, '..', '..', '..', 'data', 'reserves.json');
        this.readReservesFile();

        this.exeEventEmitter.setMaxListeners(1000);
    }

    /**
    * 実行権を取得
    * @param priority 優先度
    * @param Promise<string> 実行 id を返す
    */
    private getExecution(priority: number): Promise<string> {
        const data: ExeQueueData = {
            id: new Date().getTime().toString(16) + Math.floor(1000 * Math.random()).toString(16),
            priority: priority,
        }

        // queue に挿入
        let position = 0;
        const len = this.exeQueue.length;
        for(; position < len; position++) {
            const q = this.exeQueue[position];
            if(q.priority < data.priority) {
                break;
            }
        }
        this.exeQueue.splice(position, 0, data);

        return new Promise<string>((resolve: (value: string) => void) => {
            const onDone = (id: string) => {
                if(id === data.id) {
                    resolve(data.id);
                    this.exeEventEmitter.removeListener(ReservationManager.UNLOCK_EVENT, onDone);
                }
            }

            this.exeEventEmitter.on(ReservationManager.UNLOCK_EVENT, onDone);

            this.unLockExecution(data.id);
        });
    }

    /**
    * 実行権をアンロック
    * @param id: number
    */
    private unLockExecution(id: string): void {
        if(this.lockId === id) {
            //アンロック
            this.lockId = null;
        }

        if(this.lockId === null) {
            //次の操作に実行権を渡す
            const q = this.exeQueue.shift();
            if(typeof q !== 'undefined') {
                this.lockId = q.id;
                this.exeEventEmitter.emit(ReservationManager.UNLOCK_EVENT, q.id);
            }
        }
    }

    /**
    * チューナ情報をセット
    * @param tuners: TunerDevice[]
    */
    public setTuners(tuners: apid.TunerDevice[]): void {
        this.tuners = tuners.map((tuner) => {
            return new Tuner(tuner);
        });
    }

    /**
    * 指定した id の予約状態を取得する
    * @param programId: program id
    * @return ReserveProgram | null
    */
    public getReserve(programId: apid.ProgramId): ReserveProgram | null {
        for(let reserve of this.reserves) {
            if(reserve.program.id === programId) {
                return reserve;
            }
        }

        return null;
    }

    /**
    * すべての予約状態を取得する
    * @return ReserveProgram[]
    */
    public getReservesAll(limit?: number, offset: number = 0): ReserveProgram[] {
        if(typeof limit !== 'undefined') {
            return this.reserves.slice(offset, limit + offset);
        }
        return this.reserves;
    }

    /**
    * 予約の program id だけを取得する
    * @return ReserveAllId
    */
    public getReservesAllId(): ReserveAllId {
        let reserves: ReserveAllItem[] = [];
        let conflicts: ReserveAllItem[] = [];
        let skips: ReserveAllItem[] = [];

        this.reserves.forEach((reserve) => {
            let result: ReserveAllItem = {
                programId: reserve.program.id,
            }
            if(typeof reserve.ruleId !== 'undefined') {
                result.ruleId = reserve.ruleId;
            }

            if(reserve.isConflict) {
                conflicts.push(result);
            } else if(reserve.isSkip) {
                skips.push(result);
            } else {
                reserves.push(result);
            }
        });

        return {
            reserves: reserves,
            conflicts: conflicts,
            skips: skips,
        }
    }

    /**
    * 予約状態を取得する
    * @return ReserveProgram[]
    */
    public getReserves(limit?: number, offset: number = 0): ReserveLimit {
        let reserves = this.reserves.filter((reserve) => {
            return !reserve.isConflict && !reserve.isSkip;
        });

        return {
            reserves: typeof limit === 'undefined' ? reserves : reserves.slice(offset, limit + offset),
            total: reserves.length,
        };
    }

    /**
    * コンフリクト状態を取得する
    * @return ReserveProgram[]
    */
    public getConflicts(limit?: number, offset: number = 0): ReserveLimit {
        let reserves = this.reserves.filter((reserve) => {
            return reserve.isConflict;
        });

        return {
            reserves: typeof limit === 'undefined' ? reserves : reserves.slice(offset, limit + offset),
            total: reserves.length,
        };
    }

    /**
    * スキップを取得する
    * @return ReserveProgram[]
    */
    public getSkips(limit?: number, offset: number = 0): ReserveLimit {
        let reserves = this.reserves.filter((reserve) => {
            return reserve.isSkip;
        });

        return {
            reserves: typeof limit === 'undefined' ? reserves : reserves.slice(offset, limit + offset),
            total: reserves.length,
        };
    }

    /**
    * 予約削除(手動予約) or 予約スキップ(ルール予約)
    * @param id: program id
    * @return Promise<void>
    */
    public async cancel(id: apid.ProgramId): Promise<void> {
        const exeId = await this.getExecution(1);

        let needsUpdate = false;
        for(let i = 0; i < this.reserves.length; i++) {
            if(this.reserves[i].program.id === id) {
                if(this.reserves[i].isManual) {
                    //手動予約なら削除
                    this.reserves.splice(i, 1);
                    this.log.system.info(`cancel reserve: ${ id }`);
                    needsUpdate = true;
                    break;
                } else {
                    //ルール予約ならスキップを有効化
                    this.reserves[i].isSkip = true;
                    // skip すれば録画されないのでコンフリクトはしない
                    this.reserves[i].isConflict = false;
                    this.log.system.info(`add skip: ${ id }`);
                    needsUpdate = true;
                    break;
                }
            }
        }

        if(needsUpdate) {
            setTimeout(() => {
                this.log.system.info('start update (cancel)');

                // 予約情報をコピー
                let matches: ReserveProgram[] = [];
                for(let reserve of this.reserves) {
                    let r: any = {};
                    Object.assign(r, reserve);
                    r.isConflict = false;
                    matches.push(r);
                }

                //予約情報更新
                this.reserves = this.createReserves(matches);
                this.writeReservesFile();

                this.unLockExecution(exeId);

                //通知
                this.ipc.notifIo();

                this.log.system.info('update (cancel) done');
            }, 100);
        } else {
            this.unLockExecution(exeId);
        }
    }

    /**
    * 予約対象から除外され状態を解除する
    * @param id: number program id
    * @return Promise<void>
    */
    public async removeSkip(id: apid.ProgramId): Promise<void> {
        const exeId = await this.getExecution(1);

        for(let i = 0; i < this.reserves.length; i++) {
            if(this.reserves[i].program.id === id) {
                this.reserves[i].isSkip = false;
                this.log.system.info(`remove skip: ${ id }`);

                if(typeof this.reserves[i].ruleId !== 'undefined') {
                    this.updateRule(this.reserves[i].ruleId!);
                }
                break;
            }
        }

        this.unLockExecution(exeId);
    }

    /**
    * 手動予約追加
    * @param programId: number program id
    * @return Promise<void>
    * @throws ReservationManagerAddFailed 予約に失敗
    */
    public async addReserve(programId: apid.ProgramId, encode: EncodeInterface | null = null): Promise<void> {
        // encode option が正しいかチェック
        if(encode != null && !(new CheckRule().checkEncodeOption(encode))) {
            this.log.system.error('addReserve Failed');
            this.log.system.error('ReservationManager is Running');
            throw new Error('ReservationManagerAddFailed');
        }

        const exeId = await this.getExecution(1);
        this.log.system.info(`addReserve: ${ programId }`);

        const finalize = () => { this.unLockExecution(exeId); }

        //番組情報を取得
        let programs: DBSchema.ProgramSchema[];
        try {
            programs = await this.programDB.findId(programId, true);
        } catch(err) {
            finalize();
            throw err;
        }

        // programId に該当する録画データがなかった
        if(programs.length === 0) {
            finalize();
            this.log.system.error(`program is not found: ${ programId }`);
            throw new Error('ProgramIsNotFound');
        }

        //追加する予約情報を生成
        let addReserve: ReserveProgram = {
            program: programs[0],
            isSkip: false,
            isManual: true,
            manualId: new Date().getTime(),
            isConflict: false,
        };
        if(encode != null) {
            addReserve.encodeOption = encode;
        }

        //追加する予約情報と重複する時間帯の予約済み番組情報を conflict, skip は除外して取得
        //すでに予約済みの場合はエラー
        let reserves: ReserveProgram[] = [];
        for(let reserve of this.reserves) {
            if(reserve.program.id == programId) {
                this.log.system.error(`program is reserves: ${ programId }`);
                finalize();
                throw new Error('ReservationManagerAddFailed');
            }

            // 該当する予約情報をコピー
            if(!reserve.isConflict
                && !reserve.isSkip
                && reserve.program.startAt <= addReserve.program.endAt
                && reserve.program.endAt >= addReserve.program.startAt
            ) {
                let r: any = {};
                Object.assign(r, reserve);
                reserves.push(r);
            }
        }

        // 予約情報を生成
        reserves.push(addReserve);
        const newReserves = this.createReserves(reserves);

        // conflict したかチェック
        for(let reserve of newReserves) {
            if(reserve.isConflict) {
                finalize();
                this.log.system.error(`program id conflict: ${ programId }`);
                throw new Error('ReservationManagerAddReserveConflict');
            }
        }

        // 保存
        this.reserves.push(addReserve);
        this.reserves.sort((a, b) => { return a.program.startAt - b.program.startAt });
        this.writeReservesFile();

        finalize();

        // 通知
        this.ipc.notifIo();

        this.log.system.info(`success addReserve: ${ programId }`);
    }

    /**
    * すべての予約状態を更新
    * @return Promise<void>
    */
    public async updateAll(): Promise<void> {
        this.log.system.info('start updateAll');

        let rules = await this.rulesDB.findAllId();

        // ruleIndex を作成
        let ruleIndex: { [key: number]: boolean } = {};
        rules.forEach((result) => { ruleIndex[result.id] = true; });

        //存在しない rule を削除
        let newReserves = this.reserves.filter((reserve) => {
            return !(typeof reserve.ruleId !== 'undefined' && typeof ruleIndex[reserve.ruleId] === 'undefined');
        });
        this.reserves = newReserves;
        this.writeReservesFile();

        //手動予約の情報を更新する
        for(let reserve of this.reserves) {
            if(!reserve.isManual || typeof reserve.manualId === 'undefined') { continue; }
            await Util.sleep(10);
            await this.updateManual(reserve.manualId!);
        }

        // rule 予約の情報を更新する 
        for(let rule of rules) {
            await Util.sleep(10);
            await this.updateRule(rule.id, 0, false);
        }

        // 通知
        this.ipc.notifIo();

        this.log.system.info('updateAll done');
    }

    /**
    * 指定した 手動予約の更新
    * @param manualId: manual id
    * @return Promise<void>
    */
    public async updateManual(manualId: number): Promise<void> {
        this.log.system.info(`start UpdateManualId: ${ manualId }`);

        const exeId = await this.getExecution(0);
        const finalize = () => { this.unLockExecution(exeId); }

        // reserves の中から manualId の予約情報をコピーする
        let manualMatche: ReserveProgram | null = null;
        // manualId に該当する予約を削除した予約情報を作成
        let newReserves: ReserveProgram[] = [];
        for(let reserve of this.reserves) {
            let r: any = {};
            Object.assign(r, reserve);

            if(reserve.manualId === manualId) {
                manualMatche = r;
            } else {
                newReserves.push(r);
            }
        }

        // reserves から削除されていた
        if(manualMatche === null) {
            finalize();
            this.log.system.warn(`updateManual error: ${ manualId }`);
            return;
        }

        //番組情報を取得
        let programs: DBSchema.ProgramSchema[];
        try {
            programs = await this.programDB.findId(manualMatche!.program.id, true);
        } catch(err) {
            finalize();
            throw err;
        }

        // 該当する番組情報がなかった
        if(programs.length === 0) {
            this.reserves = newReserves;
            this.writeReservesFile();
            finalize();
            return;
        }

        //番組情報を更新
        manualMatche.program = programs[0];
        manualMatche.isConflict = false;
        newReserves.push(manualMatche);

        // 予約情報を生成
        this.reserves = this.createReserves(newReserves);
        this.writeReservesFile();

        finalize();

        // conflict を表示
        for(let reserve of this.reserves) {
            if(!reserve.isConflict || reserve.manualId !== manualId) { continue; }
            this.log.system.warn(`conflict: ${ reserve.program.id } ${ DateUtil.format(new Date(reserve.program.startAt), 'yyyy-MM-ddThh:mm:ss') } ${ reserve.program.name }`);
        }

        this.log.system.info(`UpdateManualId: ${ manualId } done`);
    }

    /**
    * 指定した rule の予約を更新
    * @param ruleId: rule id
    * @param priority: 優先度
    * @param needsNotify: 通知が必要か
    * @return Promise<void>
    */
    public async updateRule(ruleId: number, priority: number = 1, needsNotify: boolean = true): Promise<void> {
        const exeId = await this.getExecution(priority);

        const finalize = () => { this.unLockExecution(exeId); }

        this.log.system.info(`start update rule: ${ ruleId }`);

        // rule を取得
        let rule: DBSchema.RulesSchema | null = null;
        try {
            let result = await this.rulesDB.findId(ruleId);
            if(result.length !== 0 && result[0].enable) {
                rule = result[0];
            }
        } catch(err) {
            finalize();
            throw err;
        }

        // 番組情報を取得
        let programs: DBSchema.ProgramSchema[] = []
        if(rule !== null) {;
            try {
                programs = await this.programDB.findRule(this.createSearchOption(rule));
            } catch(err) {
                finalize();
                throw err;
            }
        }

        // スキップ情報
        let skipIndex: { [key: number]: boolean } = {};
        // ruleId を除外した予約情報を生成
        let matches: ReserveProgram[] = [];
        for(let reserve of this.reserves) {
            //スキップ情報を記録
            if(reserve.isSkip) { skipIndex[reserve.program.id] = reserve.isSkip; }

            if(typeof reserve.ruleId === 'undefined' || reserve.ruleId !== ruleId) {
                let r: any = {};
                Object.assign(r, reserve);
                r.isConflict = false;
                matches.push(r);
            }
        }

        if(rule !== null) {
            // ruleId の番組情報を追加
            const ruleOption = this.createOption(rule);
            const encodeOption = this.createEncodeOption(rule);
            for(let program of programs) {
                let data: ReserveProgram = {
                    program: program,
                    ruleId: ruleId,
                    ruleOption: ruleOption,
                    isSkip: typeof skipIndex[program.id] === 'undefined' ? false : skipIndex[program.id],
                    isManual: false,
                    isConflict: false,
                };
                if(encodeOption !== null) {
                    data.encodeOption = encodeOption;
                }
                matches.push(data);
            }
        }

        // 予約情報を生成
        this.reserves = this.createReserves(matches);
        this.writeReservesFile();

        finalize();

        // conflict を表示
        for(let reserve of this.reserves) {
            if(!reserve.isConflict || reserve.ruleId !== ruleId) { continue; }
            this.log.system.warn(`conflict: ${ reserve.program.id } ${ DateUtil.format(new Date(reserve.program.startAt), 'yyyy-MM-ddThh:mm:ss') } ${ reserve.program.name }`);
        }

        //通知
        if(needsNotify) { this.ipc.notifIo(); }

        this.log.system.info(`update rule: ${ ruleId } done`);
    }

    /**
    * RulesSchema から searchInterface を生成する
    * @param rule: DBSchema.RulesSchema
    * @return SearchInterface
    */
    private createSearchOption(rule: DBSchema.RulesSchema): SearchInterface {
        let search: SearchInterface = {
            week: rule.week
        }

        if(rule.keyword !== null)       { search.keyword       = rule.keyword       }
        if(rule.ignoreKeyword !== null) { search.ignoreKeyword = rule.ignoreKeyword }
        if(rule.keyCS !== null)         { search.keyCS         = rule.keyCS         }
        if(rule.keyRegExp !== null)     { search.keyRegExp     = rule.keyRegExp     }
        if(rule.title !== null)         { search.title         = rule.title         }
        if(rule.description !== null)   { search.description   = rule.description   }
        if(rule.extended !== null)      { search.extended      = rule.extended      }
        if(rule.GR !== null)            { search.GR            = rule.GR            }
        if(rule.BS !== null)            { search.BS            = rule.BS            }
        if(rule.CS !== null)            { search.CS            = rule.CS            }
        if(rule.SKY !== null)           { search.SKY           = rule.SKY           }
        if(rule.station !== null)       { search.station       = rule.station       }
        if(rule.genrelv1 !== null)      { search.genrelv1      = rule.genrelv1      }
        if(rule.genrelv2 !== null)      { search.genrelv2      = rule.genrelv2      }
        if(rule.startTime !== null)     { search.startTime     = rule.startTime     }
        if(rule.timeRange !== null)     { search.timeRange     = rule.timeRange     }
        if(rule.isFree !== null)        { search.isFree        = rule.isFree        }
        if(rule.durationMin !== null)   { search.durationMin   = rule.durationMin   }
        if(rule.durationMax !== null)   { search.durationMax   = rule.durationMax   }

        return search;
    }

    /**
    * RulesSchema から OptionInterface を生成する
    * @param rule: DBSchema.RulesSchema
    * @return OptionInterface
    */
    private createOption(rule: DBSchema.RulesSchema): OptionInterface {
        let option: OptionInterface = {
            enable: rule.enable
        };

        if(rule.directory !== null) { option.directory = rule.directory; }
        if(rule.recordedFormat !== null) { option.recordedFormat = rule.recordedFormat; }

        return option;
    }

    /**
    * RulesSchema から EncodeInterface を生成する
    * @param rule: DBSchema.RulesSchema
    * @return OptionInterface | null
    */
    public createEncodeOption(rule: DBSchema.RulesSchema): EncodeInterface | null {
        if(rule.delTs === null) { return null; }

        let encode: EncodeInterface = {
            delTs: rule.delTs
        }

        if(rule.mode1 !== null) { encode.mode1 = rule.mode1; }
        if(rule.directory1 !== null) { encode.directory1 = rule.directory1; }
        if(rule.mode2 !== null) { encode.mode2 = rule.mode2; }
        if(rule.directory2 !== null) { encode.directory2 = rule.directory2; }
        if(rule.mode3 !== null) { encode.mode3 = rule.mode3; }
        if(rule.directory3 !== null) { encode.directory3 = rule.directory3; }

        return encode;
    }

    /**
    * 予約情報を生成する
    * @param matches 予約したい番組情報
    * @return ReserveProgram[] 予約情報
    */
    private createReserves(matches: ReserveProgram[]): ReserveProgram[] {
        //重複チェックのために programId でソート
        matches.sort(this.sortReserveProgram);

        let list: {
            time: apid.UnixtimeMS,
            isStart: boolean,
            idx: number, // matches index
        }[] = [];

        // 重複チェック用 index
        let programIndex: { [key: number]: boolean } = {};

        // list を生成
        for(let i = 0; i < matches.length; i++) {
            // programId がすでに存在する場合は list に追加しない
            if(typeof programIndex[matches[i].program.id] === 'undefined') {
                programIndex[matches[i].program.id] = true;
            } else {
                continue;
            }

            list.push({
                time: matches[i].program.startAt,
                isStart: true,
                idx: i,
            });
            list.push({
                time: matches[i].program.endAt,
                isStart: false,
                idx: i,
            });
        }

        // list を time でソート
        list.sort((a, b) => { return a.time - b.time });

        // 予約情報が格納可能かチェックする
        let reserves: { reserve: ReserveProgram, idx: number }[] = [];
        for(let l of list) {
            if(matches[l.idx].isSkip) { continue; }

            if(l.isStart) {
                // add
                reserves.push({ reserve: matches[l.idx], idx: l.idx });
            } else {
                // remove
                const index = reserves.findIndex((r) => {
                    return r.idx === l.idx;
                });
                reserves.splice(index, 1);
            }

            // sort reserves
            reserves.sort((a, b) => {
                return this.sortReserveProgram(a.reserve, b.reserve);
            });

            this.log.system.debug('--------------------');
            for(let r of reserves) {
                this.log.system.debug(<any>{
                    name: r.reserve.program.name,
                    ruleId: r.reserve.ruleId!,
                });
            }

            // tuner clear
            for(let i = 0; i < this.tuners.length; i++) {
                this.tuners[i].clear();
            }

            //重複の評価
            for(let reserve of reserves) {
                if(matches[reserve.idx].isSkip) { continue; }

                let isConflict = true;
                for(let i = 0; i < this.tuners.length; i++) {
                    if(this.tuners[i].add(matches[reserve.idx].program)) {
                        isConflict = false;
                        break;
                    }
                }

                if(isConflict) {
                    matches[reserve.idx].isConflict = true;
                }
            }
        }

        // list から重複を除外した予約情報を生成
        let newReserves: ReserveProgram[] = [];
        for(let l of list) {
            if(l.isStart) { newReserves.push(matches[l.idx]); }
        }

        return newReserves.sort((a, b) => { return a.program.startAt - b.program.startAt });
    }

    /**
    * ReserveProgram のソート用関数
    * manualId が小さい > manualId が大きい > ruleId が小さい > ruleId が大きい の順で判定する
    * @param a: ReserveProgram
    * @param b: ReserveProgram
    * @return number
    */
    private sortReserveProgram(a: ReserveProgram, b: ReserveProgram): number {
        if(a.isManual && b.isManual) { return a.manualId! - b.manualId!; }
        if(a.isManual && !b.isManual) { return -1; }
        if(!a.isManual && b.isManual) { return 1; }
        if(!a.isManual && !b.isManual) { return a.ruleId! - b.ruleId!; }

        return 0;
    }

    /**
    * 終了時刻を過ぎている予約を削除する
    */
    public clean(): void {
        let now = new Date().getTime();
        this.reserves = this.reserves.filter((reserve) => {
            return !(now > reserve.program.endAt);
        });
    }

    /**
    * 予約をファイルから読み込む
    */
    private readReservesFile(): void {
        try {
            let reserves = fs.readFileSync(this.reservesPath, "utf-8");
            this.reserves = JSON.parse(reserves);
        } catch(e) {
            if(e.code == 'ENOENT') {
                this.log.system.warn('reserves.json is not found.');
                this.reserves = [];
            } else {
                this.log.system.fatal(e);
                this.log.system.fatal('reserves.json parse error');
                process.exit();
            }
        }
    }

    /**
    * 予約をファイルへ書き込む
    */
    private writeReservesFile(): void {
        fs.writeFileSync(
            this.reservesPath,
            JSON.stringify(this.reserves),
            { encoding: 'utf-8' }
        );
    }
}

namespace ReservationManager {
    export const UNLOCK_EVENT = 'ExeUnlock';
}

export { ReserveAllId, ReserveLimit, ReservationManagerInterface, ReservationManager };

