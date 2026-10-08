import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { DataSource } from 'typeorm';

// config.yml 読み込み
const configFilePath = path.join('config', 'config.yml');
const config = load(fs.readFileSync(configFilePath, 'utf-8'));

// dist 下のディレクトリ設定
const distDBBasePath = path.join('dist', 'db');
const entitie = path.join(distDBBasePath, 'entities', '**', '*.js');
const subscriber = path.join(distDBBasePath, 'subscribers', '**', '*.js');

const migrations = [path.join(distDBBasePath, 'migrations', config.dbtype, '**', '*.js')];

// database の種類に応じた設定
let ormConfig;
switch (config.dbtype) {
    case 'sqlite':
        ormConfig = new DataSource({
            // 利用者向けの設定値は 'sqlite' のまま。TypeORM 1.x は node-sqlite3 driver を
            // 廃止し better-sqlite3 へ置き換えたため、driver 名だけを読み替える。
            type: 'better-sqlite3',
            database: path.join(import.meta.dirname, 'data', 'database.db'),
            synchronize: false,
            logging: false,
            entities: [entitie],
            subscribers: [subscriber],
            migrationsRun: false,
            migrations: migrations,
        });
        break;

    case 'mysql':
        ormConfig = new DataSource({
            type: 'mysql',
            host: config.mysql.host,
            port: config.mysql.port,
            // socketPath は設定されたときだけ渡す。省略時は host / port で接続する。
            ...(typeof config.mysql.socketPath === 'undefined' ? {} : { socketPath: config.mysql.socketPath }),
            username: config.mysql.user,
            password: config.mysql.password,
            database: config.mysql.database,
            charset: typeof config.mysql.charset === 'undefined' ? 'utf8mb4' : config.mysql.charset,
            bigNumberStrings: false,
            synchronize: false,
            logging: false,
            entities: [entitie],
            subscribers: [subscriber],
            migrationsRun: false,
            migrations: migrations,
        });
        break;

    default:
        throw new Error('db config error');
}

export { ormConfig };
