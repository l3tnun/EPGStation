import * as fs from 'fs';
import * as path from 'path';
import Base from './Base';
import DBRevisionInfo from './DBRevisionInfoInterface';
import DBTableBase from './Model/DB/DBTableBase';
import MigrationBase from './Model/DB/MigrationBase';
import factory from './Model/ModelFactory';

/**
 * DBRevisionChecker
 */
class DBRevisionChecker extends Base {
    private migrations: MigrationBase[] = [];
    private tables: DBTableBase[] = [];
    private infoFilePath: string;
    private dbInfo: DBRevisionInfo | null = null;
    private currentRevision = 0;

    public constructor() {
        super();

        this.migrations.push(<MigrationBase> factory.get('MigrationV1'));

        this.tables.push(<DBTableBase> factory.get('ServicesDB'));
        this.tables.push(<DBTableBase> factory.get('ProgramsDB'));
        this.tables.push(<DBTableBase> factory.get('RulesDB'));
        this.tables.push(<DBTableBase> factory.get('RecordedDB'));
        this.tables.push(<DBTableBase> factory.get('EncodedDB'));

        this.infoFilePath = this.config.getConfig().dbInfoPath || path.join(__dirname, '..', '..', 'data', 'dbinfo.json');
        this.readFile();

        // set currentRevision
        for (const migration of this.migrations) {
            if (migration.revision > this.currentRevision) {
                this.currentRevision = migration.revision;
            }
        }
    }

    /**
     * DB version check & upgrade
     */
    public async run(): Promise<void> {
        // DB 情報がない
        if (this.dbInfo === null) {
            let cnt = 0;
            for (const table of this.tables) {
                if (await table.exists()) { cnt += 1; }
            }

            if (cnt === 0) {
                // 新規
                this.dbInfo = { revision: this.currentRevision };
                this.writeFile();
                this.log.system.info('create dbinfo.json');

                return;
            } else if (cnt === 5) {
                // version 0.5.9 以下からのアップグレード
                this.dbInfo = { revision: 0 };
                this.log.system.info('upgrade from less than or equal to version 0.5.9');
            } else {
                // DB table が欠損している
                this.log.system.fatal('DB table is missing.');
                process.exit(1);
            }
        }

        if (this.dbInfo === null) { return; }
        for (const migration of this.migrations) {
            if (migration.revision > this.dbInfo.revision) {
                // DB upgrade 処理
                this.log.system.info(`upgrade ${ this.dbInfo.revision } => ${ migration.revision }`);
                try {
                    await migration.upgrade();
                } catch (err) {
                    this.log.system.fatal('upgrade error');
                    this.log.system.fatal(err);
                    process.exit(1);
                }
                this.dbInfo.revision = migration.revision;
                this.writeFile();
            }
        }
    }

    /**
     * get current revision
     * @return number
     */
    public getCurrentRevision(): number {
        return this.currentRevision;
    }

    /**
     * get DBRevisionInfo
     * @return DBRevisionInfo
     */
    public getDBRevisionInfo(): DBRevisionInfo | null {
        return this.dbInfo;
    }

    /**
     * create new File
     */
    public createNewFile(): void {
        this.dbInfo = { revision: this.currentRevision };
        this.writeFile();
    }

    /**
     * DB revision 情報をファイルから読み込む
     */
    private readFile(): void {
        try {
            const info: string | null = fs.readFileSync(this.infoFilePath, 'utf-8');
            if (info === null) { throw new Error('db revision file is null'); }

            this.dbInfo = JSON.parse(info);
        } catch (e) {
            if (e.code === 'ENOENT') {
                this.log.system.warn('dbinfo.json is not found.');
                this.dbInfo = null;
            } else {
                this.log.system.fatal(e);
                this.log.system.fatal('dbinfo.json parse error');
                process.exit(1);
            }
        }
    }

    /**
     * DB revision 情報をファイルへ書き込む
     */
    private writeFile(): void {
        if (this.dbInfo === null) {
            this.log.system.fatal('dbInfo is null');
            process.exit(1);
        }

        fs.writeFileSync(
            this.infoFilePath,
            JSON.stringify(this.dbInfo),
            { encoding: 'utf-8' },
        );
    }
}

export default DBRevisionChecker;

