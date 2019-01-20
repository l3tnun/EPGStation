import * as path from 'path';
import Base from './Base';
import Configuration from './Configuration';
import * as Enums from './Enums';
import { Logger } from './Logger';
import { RecordedDBInterface } from './Model/DB/RecordedDB';
import ModelFactorySetting from './Model/MainModelFactorySetting';
import factory from './Model/ModelFactory';
import StrUtil from './Util/StrUtil';

/**
 * recorded の name, description, extended を
 * config の convertDBStr の形式に合わせて変換する
 */
class ConvertDBStrTools extends Base {
    private recordedDB: RecordedDBInterface;
    private convertStrType: Enums.ConvertStrType;

    constructor() {
        super();

        ModelFactorySetting.init();
        this.recordedDB = <RecordedDBInterface> factory.get('RecordedDB');

        this.convertStrType = this.config.getConfig().convertDBStr || 'oneByte';

        if (this.convertStrType === 'no') {
            throw new Error('config ConvertStrType Error');
        }
    }

    /**
     * run
     */
    public async run(): Promise<void> {
        console.log('--- get recordeds ---');
        const recordeds = await this.recordedDB.findAll();

        console.log('--- start ---');
        for (const recorded of recordeds) {
            this.recordedDB.updateProgramStrInfo(recorded.id, {
                name: this.convertStr(recorded.name)!,
                description: this.convertStr(recorded.description),
                extended: this.convertStr(recorded.extended),
            });
        }

        console.log('--- done ---');
    }

    private convertStr(str: string | null): string | null {
        return str === null ? null : StrUtil.toDBStr(str, this.convertStrType);
    }
}

Logger.initialize();
Configuration.getInstance().initialize(path.join(__dirname, '..', '..', 'config', 'config.json'), false);

(async() => {
    await new ConvertDBStrTools().run();
})()
.catch((err) => {
    console.error(err);
});

