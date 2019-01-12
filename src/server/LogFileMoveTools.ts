import * as fs from 'fs';
import * as path from 'path';
import Base from './Base';
import Configuration from './Configuration';
import { Logger } from './Logger';
import { RecordedDBInterface } from './Model/DB/RecordedDB';
import ModelFactorySetting from './Model/MainModelFactorySetting';
import factory from './Model/ModelFactory';
import FileUtil from './Util/FileUtil';
import Util from './Util/Util';

class LogFileMoveTools extends Base {
    private destinationDir: string;
    private sourceDir: string;
    private recordedDB: RecordedDBInterface;

    constructor() {
        super();

        this.destinationDir = this.config.getConfig().dropCheckLogDir;
        this.sourceDir = Util.getRecordedPath();

        if (typeof this.destinationDir === 'undefined' || this.destinationDir.length <= 0) {
            console.error('dropCheckLogDir を設定してください');
            process.exit(1);
        }

        ModelFactorySetting.init();
        this.recordedDB = <RecordedDBInterface> factory.get('RecordedDB');
    }

    /**
     * run
     */
    public async run(): Promise<void> {
        console.log('--- move log files ---');

        const rawLogPaths = await this.recordedDB.getRawLogPaths();

        for (const data of rawLogPaths) {
            // log ファイルが存在するか確認
            const sourceFile = path.join(this.sourceDir, data.logPath);
            try {
                fs.statSync(sourceFile);
            } catch (err) {
                console.error(`${ sourceFile } が見つかりません`);
                continue;
            }

            // 移動先パス取得
            const destinationFile = this.getDestinationFilePath(data.logPath);

            // move
            try {
                await FileUtil.promiseRename(sourceFile, destinationFile);
            } catch (err) {
                console.error(`${ sourceFile } の移動に失敗しました`);
                continue;
            }

            // update db
            try {
                await this.recordedDB.updateLogFilePath(data.id, destinationFile);
            } catch (err) {
                console.error(`recordedId: ${ data.id}, logPath: ${ destinationFile } の更新に失敗しました`);
                continue;
            }
        }

        console.log('--- finish ---');
    }

    /**
     * log file の移動先 path を返す
     * @param logPath: log file path
     * @param conflict: number
     * @return string
     */
    private getDestinationFilePath(logPath: string, conflict: number = 0): string {
        const extname = path.extname(logPath);
        // ファイル名生成
        let fileName = path.basename(logPath).slice(0, -1 * extname.length);
        if (conflict > 0) { fileName += `(${ conflict })`; }

        fileName += extname;

        // ファイルパス生成
        const filePath = path.join(this.destinationDir, fileName);

        // 重複チェック
        try {
            fs.statSync(filePath);

            return this.getDestinationFilePath(logPath, conflict + 1);
        } catch (err) {
            return filePath;
        }
    }
}

Logger.initialize();
Configuration.getInstance().initialize(path.join(__dirname, '..', '..', 'config', 'config.json'), false);

(async() => {
    await new LogFileMoveTools().run();
})()
.catch((err) => {
    console.error(err);
});

