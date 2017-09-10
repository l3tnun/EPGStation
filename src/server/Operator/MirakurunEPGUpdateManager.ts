import Mirakurun from 'mirakurun';
import * as apid from '../../../node_modules/mirakurun/api';
import Base from '../Base';
import CreateMirakurunClient from '../Util/CreateMirakurunClient';
import * as events from './MirakurunEPGEvents';
import { ServicesDBInterface } from '../Model/DB/ServicesDB';
import { ProgramsDBInterface } from '../Model/DB/ProgramsDB';

interface MirakurunEPGUpdateManagerInterface {
    run(): Promise<void>;
    start(): Promise<void>;
}

/**
* MirakurunEPGUpdateManager
* Mirakurun の events stream から EPG を更新する
*/
class MirakurunEPGUpdateManager extends Base implements MirakurunEPGUpdateManagerInterface {
    private static instance: MirakurunEPGUpdateManager;
    private static inited: boolean = false;
    private mirakurun: Mirakurun;
    private programQueue: events.ProgramBaseEvent[] = [];
    private serviceQueue: events.ServiceEvents[] = [];
    private servicesDB: ServicesDBInterface;
    private programsDB: ProgramsDBInterface;
    private channelTypes: { [key: number]: { [key:number]: { type: apid.ChannelType, channel: string } } } = {};

    public static getInstance(): MirakurunEPGUpdateManager {
        if(!this.inited) {
            throw new Error('MirakurunEPGUpdaterCreateInstanceError');
        }

        return this.instance;
    }

    public static init(
        servicesDB: ServicesDBInterface,
        programsDB: ProgramsDBInterface,
    ) {
        if(this.inited) { return; }
        this.instance = new MirakurunEPGUpdateManager(servicesDB, programsDB);
        this.inited = true;
    }

    private constructor(
        servicesDB: ServicesDBInterface,
        programsDB: ProgramsDBInterface,
    ) {
        super();

        this.servicesDB = servicesDB;
        this.programsDB = programsDB;
        this.mirakurun = CreateMirakurunClient.get();
    }

    /**
    * mirakurun からストリームの受信を開始する
    */
    public async run(): Promise<void> {
        // 除外放送リストの索引を生成
        let excludes: { [key: number]: boolean } = {};
        const excludeServices = this.config.getConfig().excludeServices || [];
        for(let id of excludeServices) {
            excludes[id] = true;
        }

        const stream = await this.mirakurun.getEventsStream();

        stream.on('data', (data) => {
            try {
                const event: apid.Event = <apid.Event> JSON.parse(String(data).slice( 0, -2 ));
                if(event.resource === 'service') {
                    if(typeof excludes[(<events.ServiceEvents>event).data.id] !== 'undefined') { return; }
                    this.serviceQueue.push(<events.ServiceEvents>event);
                } else if(event.resource === 'program') {
                    this.programQueue.push(<events.ProgramBaseEvent>event);
                }
            } catch(err) {
                return;
            }
        });

        // エラー処理
        stream.once('error', () => {
            this.log.system.fatal('MirakurunEPGUpdateManager stream error');
            process.exit(1);
        });

        stream.once('end', () => {
            this.log.system.fatal('MirakurunEPGUpdateManager stream end');
            process.exit(1);
        });
    }

    /**
    * 定期的に queue のデータを DB へ保存することを開始する
    */
    public async start(): Promise<void> {
        const services = await this.servicesDB.findAll();
        for(let service of services) {
            this.addService(service.networkId, service.serviceId, service.channelType, service.channel);
        }

        let isRunning = false;
        setInterval(async () => {
            if(isRunning) { return; }
            isRunning = true;
            await this.saveService();
            await this.saveProgram();
            isRunning = false;
        }, 1000 * 10);
    }

    /**
    * channelTypes に service 情報を追加
    */
    private addService(networkId: apid.NetworkId, serviceId: apid.ServiceId, type: apid.ChannelType, channel: string): void {
        if(typeof this.channelTypes[networkId] === 'undefined') {
            this.channelTypes[networkId] = {};
        }
        this.channelTypes[networkId][serviceId] = {
            type: type,
            channel: channel,
        }
    }

    /**
    * serviceQueue にたまった service を DB へ保存する
    */
    private async saveService(): Promise<void> {
        // service 取り出し
        const services = this.serviceQueue.splice(0, this.serviceQueue.length);

        if(services.length === 0) { return; }

        // 重複削除
        let serviceHash: { [key: number]: apid.Service } = {};

        for(let service of services) {
            serviceHash[service.data.id] = service.data;
        }

        let insertDatas: apid.Service[] = [];
        for(let key in serviceHash) {
            this.log.system.debug(`replace service: ${ serviceHash[key].id }`)

            const service = serviceHash[key];
            if(typeof service.channel === 'undefined') { return; }

            // program insert 用の service 情報を更新する
            this.addService(service.networkId, service.serviceId, service.channel.type, service.channel.channel);

            insertDatas.push(service);
        }

        if(insertDatas.length > 0) {
            // ServiceDB にデータを保存
            try {
                await this.servicesDB.insert(insertDatas, false);
            } catch(err) {
                this.log.system.error('update service error');
                this.log.system.error(err);
            }
        }
    }

    /**
    * programQueue にたまった program を DB へ保存
    */
    private async saveProgram(): Promise<void> {
        // program 取り出し
        const programs = this.programQueue.splice(0, this.programQueue.length);

        if(programs.length === 0) { return; }

        // 重複削除
        let insertProgramsHash: { [key: number]: apid.Program } = {};
        let deleteProgramsHash: { [key: number]: apid.ProgramId } = {};

        let queueCnt = 0;
        for(let program of programs) {
            if(program.type === 'redefine') {
                deleteProgramsHash[(<events.ReDefineEvent>program).data.from] = (<events.ReDefineEvent>program).data.from;
            } else {
                const data = (<events.CreateEvent>program).data;
                if(typeof this.channelTypes[data.networkId] !== 'undefined' && typeof this.channelTypes[data.networkId][data.serviceId] !== 'undefined') {
                    insertProgramsHash[(<events.CreateEvent>program).data.id] = (<events.CreateEvent>program).data;
                } else {
                    // service 情報が無いため ProgramQueue へ戻す
                    this.programQueue.splice(queueCnt, 0, program);
                    queueCnt += 1;
                }
            }
        }

        let replaceData: apid.Program[] = [];
        for(let key in insertProgramsHash) {
            this.log.system.debug(`replace program: ${ insertProgramsHash[key].id }`);
            this.log.system.debug(`name: ${ insertProgramsHash[key].name }`);
            replaceData.push(insertProgramsHash[key]);
        }

        if(replaceData.length > 0) {
            // replace program
            try {
                await this.programsDB.insert(this.channelTypes, replaceData, false);
            } catch(err) {
                this.log.system.error('update program error');
                this.log.system.error(err);
            }
        }

        // delete program
        for(let key in deleteProgramsHash) {
            this.log.system.debug(`delete program: ${ deleteProgramsHash[key] }`);
            try {
                await this.programsDB.delete(deleteProgramsHash[key]);
            } catch(err) {
                this.log.system.error('delete program error');
                this.log.system.error(err);
            }
        }
    }
}

export { MirakurunEPGUpdateManagerInterface, MirakurunEPGUpdateManager };

