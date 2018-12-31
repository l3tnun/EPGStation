import Mirakurun from 'mirakurun';
import * as apid from '../../../../../node_modules/mirakurun/api';
import Base from '../../../Base';
import CreateMirakurunClient from '../../../Util/CreateMirakurunClient';
import { ChannelTypeHash, ProgramsDBInterface } from '../../DB/ProgramsDB';
import { ServicesDBInterface } from '../../DB/ServicesDB';

/**
 * Mirakurun のデータを取得して DB を更新する
 */
class MirakurunUpdater extends Base {
    private servicesDB: ServicesDBInterface;
    private programsDB: ProgramsDBInterface;
    private mirakurun: Mirakurun;

    private services: apid.Service[] = [];
    private programs: apid.Program[] = [];
    private tuners: apid.TunerDevice[] = [];

    /**
     * @param servicesDB: ServicesDB
     * @param programsDB: ProgramsDB
     */
    constructor(
        servicesDB: ServicesDBInterface,
        programsDB: ProgramsDBInterface,
    ) {
        super();
        this.servicesDB = servicesDB;
        this.programsDB = programsDB;

        this.mirakurun = CreateMirakurunClient.get();
    }

    /**
     * mirakurun から EPG データを取得して DB へ保存する
     * @param callback: すべての更新が終わったら呼ばれる
     */
    public update(): Promise<void> {
        const config = this.config.getConfig();
        const suppressLog = !!config.suppressEPGUpdateLog;

        return Promise.resolve()
        .then(() => {
            return this.mirakurun.getServices();
        })
        .then((services) => {
            if (!suppressLog) {
                console.log(`mirakurun -> services: ${ services.length }`);
            }

            const excludeServices = config.excludeServices || [];
            for (let i = 0; i < services.length; i++) {
                if (excludeServices.indexOf(services[i].id) !== -1) {
                    services.splice(i, 1);
                    i -= 1;
                }
            }

            const excludeSid = config.excludeSid || [];
            for (let i = 0; i < services.length; i++) {
                if (excludeSid.indexOf(services[i].serviceId) !== -1) {
                    services.splice(i, 1);
                    i -= 1;
                }
            }

            this.services = services;

            return this.servicesDB.insert(this.services);
        })
        .then(() => {
            if (!suppressLog) {
                console.log('insert Services done');
            }

            return this.mirakurun.getPrograms();
        })
        .then((programs) => {
            if (!suppressLog) {
                console.log(`mirakurun -> programs: ${ programs.length }`);
            }
            this.programs = programs;

            // 放送波索引
            const channelTypes: ChannelTypeHash = {};
            for (const service of this.services) {
                if (typeof service.channel === 'undefined') { continue; }
                if (typeof channelTypes[service.networkId] === 'undefined') {
                    channelTypes[service.networkId] = {};
                }
                channelTypes[service.networkId][service.serviceId] = {
                    type: service.channel.type,
                    channel: service.channel.channel,
                };
            }

            return this.programsDB.insert(channelTypes, this.programs);
        })
        .then(() => {
            if (!suppressLog) {
                console.log('insert Programs done.');
            }

            return this.mirakurun.getTuners();
        })
        .then((tuners) => {
            if (!suppressLog) {
                console.log(`mirakurun -> tuners: ${ tuners.length }`);
            }
            this.tuners = tuners;

            // DB の pool 終了
            // DBBase を継承したクラスのインスタンスならどれでも良い
            return this.servicesDB.end();
        }).then(() => {
            // tuner 情報を親プロセスへ渡す
            if (typeof process.send !== 'undefined') {
                process.send({ msg: 'tuner', tuners: this.getTuners() });
            }
        })
        .catch((error: any) => {
            console.error('mirakurun updater failed');
            console.error(error);
            process.exit(1);
        });
    }

    /**
     * @return tuners
     */
    public getTuners(): apid.TunerDevice[] {
        return this.tuners;
    }
}

namespace MirakurunUpdater {
    export const MIRAKURUN_UPDATE_EVENT = 'updateMirakurun';
}

export default MirakurunUpdater;

