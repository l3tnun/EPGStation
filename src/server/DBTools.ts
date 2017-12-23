import * as fs from 'fs';
import * as path from 'path';
import * as minimist from 'minimist';
import { Logger } from './Logger';
import Configuration from './Configuration';
import ModelFactorySetting from './Model/OperatorModelFactorySetting';
import factory from './Model/ModelFactory'
import * as DBSchema from './Model/DB/DBSchema';
import { RulesDBInterface } from './Model/DB/RulesDB';
import { RecordedDBInterface } from './Model/DB/RecordedDB';
import { EncodedDBInterface } from './Model/DB/EncodedDB';

interface BackupData {
    rules: DBSchema.RulesSchema[];
    recorded: DBSchema.RecordedSchema[];
    encoded: DBSchema.EncodedSchema[];
}

class DBTools {
    private filePath: string;
    private mode: 'backup' | 'restore';
    private rulesDB: RulesDBInterface;
    private recordedDB: RecordedDBInterface;
    private encodedDB: EncodedDBInterface;

    constructor() {
        // 引数チェック
        const args = minimist(process.argv.slice(2), {
            string: [
                'output',
                'mode',
            ],
            alias: {
                o: 'output',
                m: 'mode',
            },
        });

        if(
            typeof args.output === 'undefined' || args.output === ''
            || typeof args.mode === 'undefined' || args.mode === ''
        ) {
            console.error('引数が足りません');
            process.exit(1);
        }

        if(args.mode !== 'backup' && args.mode !== 'restore') {
            console.error('mode の指定が間違っています');
            process.exit(1);
        }

        this.filePath = args.output;
        this.mode = args.mode;

        // DB Model を取得
        ModelFactorySetting.init();

        this.rulesDB = <RulesDBInterface>(factory.get('RulesDB'));
        this.recordedDB = <RecordedDBInterface>(factory.get('RecordedDB'));
        this.encodedDB = <EncodedDBInterface>(factory.get('EncodedDB'));
    }

    /**
    * run
    */
    public async run(): Promise<void> {
        if(this.mode === 'backup') {
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

        console.log('Rules');
        const rules = await this.rulesDB.findAll();

        console.log('Encoded');
        const recorded = await this.recordedDB.findAll({ isAddBaseDir: false });

        console.log('Recorded');
        const encoded = await this.encodedDB.findAll(false);

        const backup: BackupData = {
            rules: rules,
            recorded: recorded,
            encoded: encoded,
        }

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
            let file = fs.readFileSync(this.filePath, 'utf-8');
            backup = JSON.parse(file);
        } catch(err) {
            if(err.code == 'ENOENT') {
                console.error(`${ this.filePath } is not found`);
                process.exit(1);
            } else {
                console.error('file parse error');
                console.error(err);
                process.exit(1);
            }
        }

        // drop
        console.log('--- drop tables ---');
        console.log('Rules');
        await this.rulesDB.drop();

        console.log('Encoded');
        await this.encodedDB.drop();

        console.log('Recorded');
        await this.recordedDB.drop();

        // create tables
        console.log('--- create tables ---');
        console.log('Rules');
        await this.rulesDB.create()

        console.log('Recorded');
        await this.recordedDB.create();

        console.log('Encoded');
        await this.encodedDB.create();

        // restore
        console.log('--- resotre tables---');
        console.log('Rules');
        await this.rulesDB.restore(backup!.rules, false);

        console.log('Recorded');
        await this.recordedDB.restore(backup!.recorded, false, false);

        console.log('Encoded');
        await this.encodedDB.restore(backup!.encoded, false, false);

        console.log('--- complete ---');
    }
}

Logger.initialize();
Configuration.getInstance().initialize(path.join(__dirname, '..', '..', 'config', 'config.json'));

new DBTools().run();

