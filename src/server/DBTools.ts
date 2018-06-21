import * as fs from 'fs';
import * as minimist from 'minimist';
import * as path from 'path';
import Configuration from './Configuration';
import DBRevisionChecker from './DBRevisionChecker';
import DBRevisionInfo from './DBRevisionInfoInterface';
import { Logger } from './Logger';
import * as DBSchema from './Model/DB/DBSchema';
import { EncodedDBInterface } from './Model/DB/EncodedDB';
import { ProgramsDBInterface } from './Model/DB/ProgramsDB';
import { RecordedDBInterface } from './Model/DB/RecordedDB';
import { RecordedHistoryDBInterface } from './Model/DB/RecordedHistoryDB';
import { RulesDBInterface } from './Model/DB/RulesDB';
import { ServicesDBInterface } from './Model/DB/ServicesDB';
import ModelFactorySetting from './Model/MainModelFactorySetting';
import factory from './Model/ModelFactory';

interface BackupData {
    rules: DBSchema.RulesSchema[];
    recorded: DBSchema.RecordedSchema[];
    encoded: DBSchema.EncodedSchema[];
    recordedHistory: DBSchema.RecordedHistorySchema[];
    dbRevisionInfo: DBRevisionInfo;
}

class DBTools {
    private filePath: string;
    private mode: 'backup' | 'restore';
    private dbRevisionChecker: DBRevisionChecker;
    private servicesDB: ServicesDBInterface;
    private programsDB: ProgramsDBInterface;
    private rulesDB: RulesDBInterface;
    private recordedDB: RecordedDBInterface;
    private encodedDB: EncodedDBInterface;
    private recordedHistoryDB: RecordedHistoryDBInterface;

    constructor() {
        // 引数チェック
        const args = minimist(process.argv.slice(2), {
            alias: {
                m: 'mode',
                o: 'output',
            },
            string: [
                'output',
                'mode',
            ],
        });

        if (
            typeof args.output === 'undefined' || args.output === ''
            || typeof args.mode === 'undefined' || args.mode === ''
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

        ModelFactorySetting.init();
        this.dbRevisionChecker = new DBRevisionChecker();

        // DB Model を取得
        this.servicesDB = <ServicesDBInterface> factory.get('ServicesDB');
        this.programsDB = <ProgramsDBInterface> factory.get('ProgramsDB');
        this.rulesDB = <RulesDBInterface> factory.get('RulesDB');
        this.recordedDB = <RecordedDBInterface> factory.get('RecordedDB');
        this.encodedDB = <EncodedDBInterface> factory.get('EncodedDB');
        this.recordedHistoryDB = <RecordedHistoryDBInterface> factory.get('RecordedHistoryDB');
    }

    /**
     * run
     */
    public async run(): Promise<void> {
        if (this.mode === 'backup') {
            await this.backup();
        } else {
            await this.restore();
        }

        // DB 接続切断
        this.rulesDB.end();
    }

    /**
     * backup
     */
    private async backup(): Promise<void> {
        console.log('--- read datas ---');
        console.log('DB Revision Info');
        const dbRevisionInfo = await this.dbRevisionChecker.getDBRevisionInfo();

        if (dbRevisionInfo === null) {
            console.error('DB Revision Info is not found');

            return;
        }

        console.log('Rules');
        const rules = await this.rulesDB.findAll();

        console.log('Encoded');
        const recorded = await this.recordedDB.findAll({ isAddBaseDir: false });

        console.log('Recorded');
        const encoded = await this.encodedDB.findAll(false);

        console.log('RecordedHistory');
        const recordedHistory = await this.recordedHistoryDB.findAll();

        const backup: BackupData = {
            dbRevisionInfo: dbRevisionInfo,
            encoded: encoded,
            recorded: recorded,
            rules: rules,
            recordedHistory: recordedHistory,
        };

        console.log('--- writing ---');

        fs.writeFileSync(
            this.filePath,
            JSON.stringify(backup),
            { encoding: 'utf-8' },
        );

        console.log('--- complete ---');
    }

    /**
     * restore
     */
    private async restore(): Promise<void> {
        // read backup
        let backup: BackupData;
        try {
            const file: string | null = fs.readFileSync(this.filePath, 'utf-8');
            if (file === null) { throw new Error('file is null'); }
            backup = JSON.parse(file);
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.error(`${ this.filePath } is not found`);
                process.exit(1);
            } else {
                console.error('file parse error');
                console.error(err);
                process.exit(1);
            }
        }

        // db revision check
        console.log('--- check DB Revision ---');
        const currentRevision = this.dbRevisionChecker.getCurrentRevision();
        if (currentRevision !== backup!.dbRevisionInfo.revision) {
            console.error('Revision information is wrong');
            process.exit(1);
        }

        // create new DB Info  file
        console.log('--- create new DB Info file ---');
        this.dbRevisionChecker.createNewFile();

        // drop
        console.log('--- drop tables ---');
        console.log('Services');
        await this.servicesDB.drop();

        console.log('Programs');
        await this.programsDB.drop();

        console.log('Rules');
        await this.rulesDB.drop();

        console.log('Recorded');
        await this.recordedDB.drop();

        console.log('Encoded');
        await this.encodedDB.drop();

        console.log('RecordedHistory');
        await this.recordedHistoryDB.drop();

        // create tables
        console.log('--- create tables ---');
        console.log('Services');
        await this.servicesDB.create();

        console.log('Programs');
        await this.programsDB.create();

        console.log('Rules');
        await this.rulesDB.create();

        console.log('Recorded');
        await this.recordedDB.create();

        console.log('Encoded');
        await this.encodedDB.create();

        console.log('RecordedHistory');
        await this.recordedHistoryDB.create();

        // restore
        console.log('--- resotre tables---');
        console.log('Rules');
        await this.rulesDB.restore(backup!.rules, false);

        console.log('Recorded');
        await this.recordedDB.restore(backup!.recorded, false, false);

        console.log('Encoded');
        await this.encodedDB.restore(backup!.encoded, false, false);

        console.log('RecordedHistory');
        await this.recordedHistoryDB.restore(backup!.recordedHistory, false);

        console.log('--- complete ---');
    }
}

Logger.initialize();
Configuration.getInstance().initialize(path.join(__dirname, '..', '..', 'config', 'config.json'));

new DBTools().run();

