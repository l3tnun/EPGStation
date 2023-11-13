/* eslint-disable no-case-declarations */
import { EventEmitter } from 'events';
import { IncomingMessage } from 'http';
import { inject, injectable } from 'inversify';
import mirakurun from 'mirakurun';
import * as mapid from '../../../node_modules/mirakurun/api';
import IChannelDB from '../db/IChannelDB';
import IChannelTypeIndex from '../db/IChannelTypeHash';
import IProgramDB from '../db/IProgramDB';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IMirakurunClientModel from '../IMirakurunClientModel';
import IEPGUpdateManageModel, {
    ProgramBaseEvent,
    UpdateEvent,
    RemoveEvent,
    RedefineEvent,
    ServiceEvent,
} from './IEPGUpdateManageModel';

@injectable()
class EPGUpdateManageModel extends EventEmitter implements IEPGUpdateManageModel {
    private log: ILogger;
    private mirakurunClient: mirakurun;
    private channelDB: IChannelDB;
    private programDB: IProgramDB;

    private programQueue: ProgramBaseEvent[] = [];
    private serviceQueue: ServiceEvent[] = [];

    // 放送局索引情報
    private channelIndex: IChannelTypeIndex = {};

    // 除外放送局索引情報
    private excludeChannelIndex: { [channelId: number]: boolean } = {};
    private excludeSidIndex: { [serviceId: number]: boolean } = {};

    constructor(
        @inject('ILoggerModel') loggerModel: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IMirakurunClientModel')
        mirakurunClientModel: IMirakurunClientModel,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IProgramDB') programDB: IProgramDB,
    ) {
        super();

        this.log = loggerModel.getLogger();
        this.mirakurunClient = mirakurunClientModel.getClient();
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
                clearTimeout(timeout);
                throw new Error('EPGUpdateAllTimeoutError');
            },
            10 * 60 * 1000,
        );

        this.log.system.info('get programs');
        const programs = await this.mirakurunClient.getPrograms().catch(err => {
            this.log.system.error('get programs error');
            this.log.system.error(err);
            clearTimeout(timeout);
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
            clearTimeout(timeout);
            throw err;
        });
        this.log.system.info('done update programs');

        clearTimeout(timeout);
    }

    /**
     * relatedItems からメインの番組情報か判定する
     * @param program: mapid.Program
     * @returns boolean true ならメインの番組
     */
    private isMainProgram(program: mapid.Program): boolean {
        if (typeof program.relatedItems === 'undefined') {
            return true;
        }

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

            // type が shared でメインの放送か？
            if (item.eventId === program.eventId && item.serviceId === program.serviceId) {
                return true;
            }
        }

        return false;
    }

    /**
     * 放送局情報更新
     */
    public async updateChannels(): Promise<void> {
        this.log.system.info('get service');
        let services = await this.mirakurunClient.getServices().catch(err => {
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
    private updateChannelIndex(services: mapid.Service[]): void {
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
     * mirakurun の event stream の受信を開始する
     */
    public async start(): Promise<void> {
        this.log.system.info('start get stream');

        const eventStream = await this.mirakurunClient.getEventsStream().catch(err => {
            this.log.system.error('event stream get error');
            this.log.system.error(err);
            this.stopStream(eventStream);
            throw err;
        });

        this.emit('event stream started');

        return new Promise<void>(async (_resolve: () => void, reject: (err: Error) => void) => {
            // エラー処理
            eventStream.once('error', err => {
                this.log.system.error('event stream error');
                this.log.system.error(err);
                this.stopStream(eventStream);
                this.emit('event stream aborted');
                reject(err);
            });

            eventStream.once('end', () => {
                this.log.system.error('event stream is ended');
                this.stopStream(eventStream);
                reject(new Error('EndedEventStream'));
            });

            eventStream.once('close', () => {
                this.log.system.error('event stream is closed');
                this.stopStream(eventStream);
                reject(new Error('ClosedEventStream'));
            });

            // イベント受信処理
            let tmp = Buffer.from([]);
            eventStream.on('data', chunk => {
                // tmp の末尾が [\n の場合無視
                if (Buffer.compare(chunk, EPGUpdateManageModel.START_STRING) === 0) {
                    return;
                }

                tmp = Buffer.concat([tmp, chunk]);

                // tmp の末尾が },\n かチェック
                if (
                    Buffer.compare(
                        tmp.slice(tmp.length - EPGUpdateManageModel.DATA_DELIMITER_STRING.length, tmp.length),
                        EPGUpdateManageModel.DATA_DELIMITER_STRING,
                    ) !== 0
                ) {
                    // JSON parse 可能ではない
                    return;
                }

                try {
                    // event 情報をパースして queue に積む
                    this.log.system.debug(String(tmp));
                    const events: mapid.Event[] = <mapid.Event[]>JSON.parse(`[${String(tmp).slice(0, -3)}]`);
                    for (const event of events) {
                        if (event.resource === 'program') {
                            this.programQueue.push(<any>event);
                        } else if (event.resource === 'service') {
                            this.serviceQueue.push(<any>event);
                        }
                    }
                    this.log.system.debug('OK');
                } catch (err: any) {
                    this.log.system.error('event stream parse error');
                    const tmpHex = tmp.toString('hex').match(/../g);
                    if (tmpHex !== null) {
                        this.log.system.debug(tmpHex.join(' '));
                    }
                    this.log.system.error(err);
                    this.stopStream(eventStream);
                    this.emit('event stream aborted');
                    reject(new Error('EventStreamParseError'));
                }
                tmp = Buffer.from([]);
            });
        });
    }

    /**
     * event stream を止める
     * @param stream: IncomingMessage
     */
    private stopStream(stream: IncomingMessage): void {
        stream.destroy();
        stream.push(null); // eof 通知
        stream.removeAllListeners();
        this.programQueue = [];
        this.serviceQueue = [];
    }

    /**
     * programQueue のサイズを返す
     * @return number
     */
    public getProgramQueueSize(): number {
        return this.programQueue.length;
    }

    /**
     * serviceQueue のサイズを返す
     * @return number
     */
    public getServiceQueueSize(): number {
        return this.serviceQueue.length;
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

            if (timeThreshold === 0) needToSave = true;

            // eventを時系列を意識して整理
            for (const event of programs) {
                if (event.type === 'create' || event.type === 'update') {
                    const program = (<UpdateEvent>event).data;
                    if (typeof program.name !== 'undefined' && this.isMainProgram(program) === true) {
                        updateIndex[program.id] = event;
                        if (program.startAt < timeThreshold) needToSave = true;
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
                } else if ((event as any).type === 'redefine') {
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
                const deleteValues: Array<mapid.ProgramId> = [];
                const insertValues: Array<mapid.Program> = [];
                const updateValues: Array<mapid.Program> = [];

                for (const [_id, event] of Object.entries(deleteIndex)) {
                    deleteValues.push((<RemoveEvent>event).data.id);
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

                    this.emit('program updated');
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
        const serviceDatas = await this.mirakurunClient.getServices().catch(err => {
            this.log.system.error('get service error');
            this.log.system.error(err);
            return [] as mapid.Service[];
        });
        const serviceDataIndex: { [serviceId: number]: mapid.Service } = {};
        for (const s of serviceDatas) {
            serviceDataIndex[s.id] = s;
        }

        const createIndex: { [serviceId: number]: mapid.Service } = {}; // 追加用索引
        const updateIndex: { [serviceId: number]: mapid.Service } = {}; // 更新用索引

        for (const service of services) {
            if (
                typeof this.excludeChannelIndex[service.data.id] !== 'undefined' ||
                typeof this.excludeSidIndex[service.data.serviceId] !== 'undefined'
            ) {
                // 除外索引に含まれる放送局を削除
                continue;
            }

            // add hasLogoData
            if (typeof serviceDataIndex[service.data.id] !== 'undefined') {
                service.data.hasLogoData = serviceDataIndex[service.data.id].hasLogoData;
            }
            switch (service.type) {
                case 'create':
                    if (typeof service.data.name !== 'undefined') {
                        createIndex[service.data.id] = service.data;
                    }
                    break;
                case 'update':
                    if (typeof service.data !== 'undefined') {
                        updateIndex[service.data.id] = service.data;
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
        this.emit('service updated');
    }
}

namespace EPGUpdateManageModel {
    // event stream の開始文字列
    export const START_STRING = Buffer.from([0x5b, 0x0a]);
    export const DATA_DELIMITER_STRING = Buffer.from([0x7d, 0x0a, 0x2c, 0x0a]);
}

export default EPGUpdateManageModel;
