/* eslint-disable no-case-declarations */
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
    CreateEvent,
    ProgramBaseEvent,
    RedefineEvent,
    ServiceEvent,
} from './IEPGUpdateManageModel';

@injectable()
class EPGUpdateManageModel implements IEPGUpdateManageModel {
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
        const timeout = setTimeout(() => {
            this.log.system.error('update all timeout');
            clearTimeout(timeout);
            throw new Error('EPGUpdateAllTimeoutError');
        }, 10 * 60 * 1000);

        this.log.system.info('get programs');
        const programs = await this.mirakurunClient.getPrograms().catch(err => {
            this.log.system.error('get programs error');
            this.log.system.error(err);
            clearTimeout(timeout);
            throw err;
        });
        this.log.system.info('done get programs');

        this.log.system.info('start update programs');
        await this.programDB.insert(this.channelIndex, programs).catch(err => {
            this.log.system.error('update programs error');
            this.log.system.error(err);
            clearTimeout(timeout);
            throw err;
        });
        this.log.system.info('done update programs');

        clearTimeout(timeout);
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

        return new Promise<void>(async (_resolve: () => void, reject: (err: Error) => void) => {
            // エラー処理
            eventStream.once('error', err => {
                this.log.system.error('event stream error');
                this.log.stream.error(err);
                this.stopStream(eventStream);
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
                } catch (err) {
                    this.log.system.error('event stream parse error');
                    const tmpHex = tmp.toString('hex').match(/../g);
                    if (tmpHex !== null) {
                        this.log.system.debug(tmpHex.join(' '));
                    }
                    this.log.system.error(err);
                    this.stopStream(eventStream);
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
    public async saveProgram(): Promise<void> {
        // 取り出し
        const programs = this.programQueue.splice(0, this.programQueue.length);

        if (programs.length === 0) {
            return;
        }

        this.log.system.info('start save program');

        const deleteIndex: { [programId: number]: mapid.ProgramId } = {}; // 削除用索引
        const createIndex: { [programId: number]: mapid.Program } = {}; // 追加用索引
        const updateIndex: { [programId: number]: mapid.Program } = {}; // 更新用索引

        for (const program of programs) {
            switch (program.type) {
                case 'create':
                    const createData = (<CreateEvent>program).data;
                    if (typeof createData.name !== 'undefined') {
                        createIndex[createData.id] = createData;
                    }
                    break;
                case 'update':
                    const updateData = (<CreateEvent>program).data;
                    if (typeof updateData !== 'undefined') {
                        updateIndex[updateData.id] = updateData;
                    }
                    break;
                case 'redefine':
                    const from = (<RedefineEvent>program).data.from;
                    deleteIndex[from] = from;
                    break;
            }
        }

        const deleteValues = Object.values(deleteIndex);
        const insertValues = Object.values(createIndex);
        const updateValues = Object.values(updateIndex);

        this.log.system.info({
            deleteValues: deleteValues.length,
            insertValues: insertValues.length,
            updateValues: updateValues.length,
        });

        this.log.stream.info('update db');
        await this.programDB.update(this.channelIndex, {
            insert: insertValues,
            update: updateValues,
            delete: deleteValues,
        });

        this.log.system.info('update db done');
    }

    /**
     * 現在時刻より古い番組情報を削除
     */
    public async deleteOldPrograms(): Promise<void> {
        await this.programDB.deleteOld(new Date().getTime());
    }

    /**
     * serviceQueue の program を DB へ反映させる
     */
    public async saveSevice(): Promise<void> {
        // 取り出し
        const services = this.serviceQueue.splice(0, this.serviceQueue.length);

        if (services.length === 0) {
            return;
        }

        const createIndex: { [serviceId: number]: mapid.Service } = {}; // 追加用索引
        const updateIndex: { [serviceId: number]: mapid.Service } = {}; // 更新用索引

        this.log.system.info('start save service');

        for (const service of services) {
            if (
                typeof this.excludeChannelIndex[service.data.id] !== 'undefined' ||
                typeof this.excludeSidIndex[service.data.serviceId] !== 'undefined'
            ) {
                // 除外索引に含まれる放送局を削除
                continue;
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
                case 'redefine':
                    // redefine は存在しない
                    throw new Error('ServiceRedefine');
                    break;
            }
        }

        const insertValues = Object.values(createIndex);
        const updateValues = Object.values(updateIndex);

        this.log.system.info({
            insertValues: insertValues.length,
            updateValues: updateValues.length,
        });

        this.log.stream.info('update db');
        await this.channelDB.update({
            insert: insertValues,
            update: updateValues,
        });

        // 放送局索引情報更新
        this.updateChannelIndex(insertValues);
        this.updateChannelIndex(updateValues);

        this.log.system.info('update db done');
    }
}

namespace EPGUpdateManageModel {
    // event stream の開始文字列
    export const START_STRING = Buffer.from([0x5b, 0x0a]);
    export const DATA_DELIMITER_STRING = Buffer.from([0x7d, 0x0a, 0x2c, 0x0a]);
}

export default EPGUpdateManageModel;
