import { EventEmitter } from 'events';
import { inject, injectable } from 'inversify';
import IChannelDB from '../db/IChannelDB.js';
import IChannelTypeIndex from '../db/IChannelTypeHash.js';
import IProgramDB from '../db/IProgramDB.js';
import IConfiguration from '../IConfiguration.js';
import ILogger from '../ILogger.js';
import ILoggerModel from '../ILoggerModel.js';
import {
    ProgramId,
    TunerChange,
    TunerProgram,
    TunerServerAccess,
    TunerServerId,
    TunerService,
} from '../tuner/types.js';
import IEPGUpdateManageModel, {
    ProgramBaseEvent,
    UpdateEvent,
    RemoveEvent,
    RedefineEvent,
    ServiceEvent,
    EPGUpdateEvent,
} from './IEPGUpdateManageModel.js';

/** `IEPGUpdateManageModel` の実装。詳細は `IEPGUpdateManageModel` を参照。 */
@injectable()
class EPGUpdateManageModel extends EventEmitter implements IEPGUpdateManageModel {
    private log: ILogger;
    private tunerServerAccess: TunerServerAccess;
    private channelDB: IChannelDB;
    private programDB: IProgramDB;

    private programQueue: ProgramBaseEvent[] = [];
    private serviceQueue: ServiceEvent[] = [];

    // 放送局索引情報
    private channelIndex: IChannelTypeIndex = {};

    // 除外放送局索引情報
    private excludeChannelIndex: { [channelId: number]: boolean } = {};
    private excludeSidIndex: { [serviceId: number]: boolean } = {};

    private updatedOnAirServiceIds: { [serviceId: TunerServerId]: boolean } = {};
    private updateServiceIds: { [serviceId: TunerServerId]: boolean } = {};

    constructor(
        @inject('ILoggerModel') loggerModel: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('TunerServerAccess') tunerServerAccess: TunerServerAccess,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IProgramDB') programDB: IProgramDB,
    ) {
        super();

        this.log = loggerModel.getLogger();
        this.tunerServerAccess = tunerServerAccess;
        this.channelDB = channelDB;
        this.programDB = programDB;

        // 除外放送局索引情報のセット
        const config = configuration.getConfig();
        if (typeof config.excludeChannels !== 'undefined') {
            for (const c of config.excludeChannels) {
                this.excludeChannelIndex[c] = true;
            }
        }
        if (typeof config.excludeSids !== 'undefined') {
            for (const c of config.excludeSids) {
                this.excludeSidIndex[c] = true;
            }
        }
    }

    /**
     * 番組情報全件更新処理
     */
    public async updateAll(): Promise<void> {
        await this.updateChannels();

        // タイムアウト設定
        const timeout = setTimeout(
            () => {
                this.log.system.error('update all timeout');
            },
            10 * 60 * 1000,
        );

        try {
            this.log.system.info('get programs');
            const programs = await this.tunerServerAccess.getPrograms().catch(err => {
                this.log.system.error('get programs error');
                this.log.system.error(err);
                throw err;
            });
            this.log.system.info('done get programs');

            // メインの番組情報だけ取り出す
            const insertPrograms = programs.filter(p => {
                return this.isMainProgram(p);
            });

            this.log.system.info('start update programs');
            await this.programDB.insert(this.channelIndex, insertPrograms).catch(err => {
                this.log.system.error('update programs error');
                this.log.system.error(err);
                throw err;
            });
            this.log.system.info('done update programs');
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * relatedItems からメインの番組情報か判定する
     * @param program: TunerProgram
     * @returns boolean true ならメインの番組
     */
    private isMainProgram(program: TunerProgram): boolean {
        if (typeof program.relatedItems === 'undefined') {
            return true;
        }

        let isOnlyRelayType = true;
        for (const item of program.relatedItems) {
            // Mirakurun 3.8 以下では type が存在しない && relatedItems が機能していないので true を返す
            if (typeof item.type === 'undefined') {
                return true;
            }

            // 移動したイベントか？
            if (item.type === 'movement') {
                return true;
            }

            // リレーの場合は無視
            if (item.type === 'relay') {
                continue;
            }

            // issue #681
            // shared が存在するなら false にする
            isOnlyRelayType = false;

            // type が shared でメインの放送か？
            if (item.eventId === program.eventId && item.serviceId === program.serviceId) {
                return true;
            }
        }

        // issue #681
        // type が relay だけしか存在しないものは true とする
        if (isOnlyRelayType === true) {
            return true;
        }

        return false;
    }

    /**
     * 放送局情報更新
     */
    public async updateChannels(): Promise<void> {
        this.log.system.info('get service');
        let services = await this.tunerServerAccess.getServices().catch(err => {
            this.log.system.error('get service error');
            this.log.system.error(err);
            throw err;
        });

        // 除外索引に含まれる放送局を削除
        services = services.filter(s => {
            return (
                typeof this.excludeChannelIndex[s.id] === 'undefined' &&
                typeof this.excludeSidIndex[s.serviceId] === 'undefined'
            );
        });

        this.log.system.info('start update channel');
        await this.channelDB.insert(services).catch(err => {
            this.log.system.error('update channel error');
            this.log.system.error(err);
            throw err;
        });
        this.log.system.info('done update channel');

        // 放送局索引作成
        this.channelIndex = {};
        this.updateChannelIndex(services);
    }

    /**
     * 放送局索引更新
     * @param services: Service[]
     * @return void
     */
    private updateChannelIndex(services: TunerService[]): void {
        for (const service of services) {
            if (typeof service.channel === 'undefined') {
                continue;
            }
            if (typeof this.channelIndex[service.networkId] === 'undefined') {
                this.channelIndex[service.networkId] = {};
            }
            this.channelIndex[service.networkId][service.serviceId] = {
                id: service.id,
                type: service.channel.type,
                channel: service.channel.channel,
            };
        }
    }

    /**
     * event stream の解析を開始する
     */
    public async start(): Promise<void> {
        const handle = await this.tunerServerAccess.openChangeFeed({
            started: () => {
                this.emit(EPGUpdateEvent.STREAM_STARTED);
            },
            changed: change => {
                this.consumeChange(change);
            },
            aborted: error => {
                this.log.system.error('tuner change feed error');
                this.log.system.error(error);
                this.emit(EPGUpdateEvent.STREAM_ABORTED);
            },
        });

        await handle.completion;
    }

    private consumeChange(change: TunerChange): void {
        switch (change.kind) {
            case 'program':
                switch (change.operation) {
                    case 'create':
                    case 'update':
                        this.programQueue.push({
                            resource: 'program',
                            type: change.operation,
                            data: change.program,
                            time: change.time,
                        });
                        break;
                    case 'remove':
                        this.programQueue.push({
                            resource: 'program',
                            type: 'remove',
                            data: { id: change.programId },
                            time: change.time,
                        });
                        break;
                    case 'redefine':
                        this.programQueue.push({
                            resource: 'program',
                            type: 'redefine',
                            data: { from: change.from, to: change.to },
                            time: change.time,
                        });
                        break;
                }
                break;
            case 'service':
                this.serviceQueue.push({
                    resource: 'service',
                    type: change.operation,
                    data: change.service,
                    time: change.time,
                });
                break;
            case 'on-air-service':
                this.updatedOnAirServiceIds[change.serviceId] = true;
                break;
            case 'service-programs-updated':
                this.updateServiceIds[change.serviceId] = true;
                break;
        }
    }

    /**
     * programQueue の program を DB へ反映させる
     */
    public async saveProgram(timeThreshold: number = 0): Promise<void> {
        // 取り出し
        const programs = this.programQueue.splice(0, this.programQueue.length);
        if (programs.length === 0) {
            return;
        }
        this.log.system.debug('number of de-queued items: %d', programs.length);

        try {
            const deleteIndex: { [programId: number]: ProgramBaseEvent } = {}; // 追加用索引
            const updateIndex: { [programId: number]: ProgramBaseEvent } = {}; // 追加用索引
            let needToSave = false;

            if (timeThreshold === 0) {
                needToSave = true;
            }

            // eventを時系列を意識して整理
            for (const event of programs) {
                if (event.type === 'create' || event.type === 'update') {
                    const program = (<UpdateEvent>event).data;
                    if (typeof program.name !== 'undefined' && this.isMainProgram(program) === true) {
                        updateIndex[program.id] = event;
                        if (program.startAt < timeThreshold) {
                            needToSave = true;
                        }

                        if (program.id in deleteIndex) {
                            // このEvent以前に受信した"remove" or "redefine" Eventは破棄する
                            delete deleteIndex[program.id];
                        }
                    }
                } else if (event.type === 'remove') {
                    const removeData = (<RemoveEvent>event).data;
                    deleteIndex[removeData.id] = event;
                    if (removeData.id in updateIndex) {
                        // このEvent以前に受信した"create" or "update" Eventは破棄する
                        delete updateIndex[removeData.id];
                    }
                } else if (event.type === 'redefine') {
                    // redefine は古いバージョンをサポートするため
                    const from = (<RedefineEvent>event).data.from;
                    deleteIndex[from] = event;
                    if (from in updateIndex) {
                        // このEvent以前に受信した"create" or "update" Eventは破棄する
                        delete updateIndex[from];
                    }
                }
            }

            if (needToSave) {
                const deleteValues: ProgramId[] = [];
                const insertValues: TunerProgram[] = [];
                const updateValues: TunerProgram[] = [];

                for (const [id] of Object.entries(deleteIndex)) {
                    const programId = Number(id);
                    if (Number.isFinite(programId) && Number.isInteger(programId)) {
                        deleteValues.push(programId);
                    }
                }
                for (const [_id, event] of Object.entries(updateIndex)) {
                    updateValues.push((<UpdateEvent>event).data);
                }

                if (deleteValues.length > 0 || insertValues.length > 0 || updateValues.length > 0) {
                    this.log.system.info('update program db start');
                    this.log.system.info({
                        deleteValues: deleteValues.length,
                        insertValues: insertValues.length,
                        updateValues: updateValues.length,
                    });

                    await this.programDB.update(this.channelIndex, {
                        insert: insertValues,
                        update: updateValues,
                        delete: deleteValues,
                    });
                    this.log.system.info('update program db done');

                    this.emit(EPGUpdateEvent.PROGRAM_UPDATED);
                }
            } else {
                // 整理した結果のEventをキューへ戻す
                // NOTE: "remove"イベントは先頭へ
                this.log.system.debug(
                    'number of re-queued items: %d',
                    Object.keys(deleteIndex).length + Object.keys(updateIndex).length,
                );
                this.programQueue = Object.values(deleteIndex).concat(Object.values(updateIndex), this.programQueue);
            }
        } catch (err: any) {
            // キューへ全て戻す
            this.log.system.debug('number of re-queued items: %d', programs.length);
            this.programQueue = programs.concat(this.programQueue);
            throw err;
        }
    }

    /**
     * 現在時刻より古い番組情報を削除
     */
    public async deleteOldPrograms(): Promise<void> {
        this.log.system.info('delete old program db start');
        await this.programDB.deleteOld(new Date().getTime());
        this.log.system.info('delete old program db done');
    }

    /**
     * serviceQueue の program を DB へ反映させる
     */
    public async saveService(): Promise<void> {
        // 取り出し
        const services = this.serviceQueue.splice(0, this.serviceQueue.length);

        if (services.length === 0) {
            return;
        }

        // ロゴデータ保持判定のために放送局情報をすべて取得する
        const serviceDatas = await this.tunerServerAccess.getServices().catch(err => {
            this.log.system.error('get service error');
            this.log.system.error(err);
            return [] as TunerService[];
        });
        const serviceDataIndex: { [serviceId: number]: TunerService } = {};
        for (const s of serviceDatas) {
            serviceDataIndex[s.id] = s;
        }

        const createIndex: { [serviceId: number]: TunerService } = {}; // 追加用索引
        const updateIndex: { [serviceId: number]: TunerService } = {}; // 更新用索引

        for (const service of services) {
            if (
                typeof this.excludeChannelIndex[service.data.id] !== 'undefined' ||
                typeof this.excludeSidIndex[service.data.serviceId] !== 'undefined'
            ) {
                // 除外索引に含まれる放送局を削除
                continue;
            }

            const currentService = serviceDataIndex[service.data.id];
            const serviceData =
                currentService === undefined
                    ? service.data
                    : { ...service.data, hasLogoData: currentService.hasLogoData };
            switch (service.type) {
                case 'create':
                    if (typeof serviceData.name !== 'undefined') {
                        createIndex[serviceData.id] = serviceData;
                    }
                    break;
                case 'update':
                    if (typeof serviceData !== 'undefined') {
                        updateIndex[serviceData.id] = serviceData;
                    }
                    break;
                case 'remove':
                    // TODO 要確認
                    // throw new Error('ServiceRedefine');
                    break;
            }
        }

        const insertValues = Object.values(createIndex);
        const updateValues = Object.values(updateIndex);

        this.log.system.info('update channel db start');
        this.log.system.info({
            insertValues: insertValues.length,
            updateValues: updateValues.length,
        });

        await this.channelDB.update({
            insert: insertValues,
            update: updateValues,
        });

        // 放送局索引情報更新
        this.updateChannelIndex(insertValues);
        this.updateChannelIndex(updateValues);

        this.log.system.info('update channel db done');
        this.emit(EPGUpdateEvent.SERVICE_UPDATED);
    }

    /**
     * mirakc の /events で確認された放映中のサービスの番組情報の更新
     */
    public async saveOnAirServices(): Promise<void> {
        const channelIds = Object.keys(this.updatedOnAirServiceIds).map(str => parseInt(str, 10));

        // 更新対象が無ければ何もしない
        if (channelIds.length === 0) {
            return;
        }

        await this.saveMirakcServices(channelIds);

        // 更新したサービスを this.updatedOnAirServiceIds から削除
        for (const channelId of channelIds) {
            delete this.updatedOnAirServiceIds[channelId];
        }
    }

    /**
     * mirakc の /events で確認された更新が必要なサービスの番組情報の更新
     */
    public async saveUpdateServices(): Promise<void> {
        const channelIds = Object.keys(this.updateServiceIds).map(str => parseInt(str, 10));

        // 更新対象が無ければ何もしない
        if (channelIds.length === 0) {
            return;
        }

        await this.saveMirakcServices(channelIds);

        // 更新したサービスを this.updateServiceIds から削除
        for (const channelId of channelIds) {
            delete this.updateServiceIds[channelId];
        }
    }

    /**
     * 指定された channelId の番組情報を全件削除および全件更新する
     * @param channelIds
     */
    private async saveMirakcServices(channelIds: TunerServerId[]): Promise<void> {
        // 番組情報を更新する前にチャンネル情報を更新する (更新する契機が存在しないため)
        await this.updateChannels();

        // 更新対象の番組情報を取得する
        this.log.system.info('get service programs');
        const insertPrograms: TunerProgram[] = [];
        for (const serviceId of channelIds) {
            const servicePrograms = await this.tunerServerAccess.getProgramsByService(serviceId);

            // メインプログラムだけ取り出す
            for (const p of servicePrograms) {
                if (this.isMainProgram(p) === true) {
                    insertPrograms.push(p);
                }
            }
        }

        // DB 更新
        this.log.system.info('start update service programs');
        await this.programDB.insert(this.channelIndex, insertPrograms, channelIds).catch(err => {
            this.log.system.error('update service programs error');
            this.log.system.error(err);
            throw err;
        });
        this.log.system.info('done update service programs');
    }
}

export default EPGUpdateManageModel;
