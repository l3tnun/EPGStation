import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { DataSource } from 'typeorm';
// `!env` と `dbtype` の読み替えは、EPGStation 本体と同じ定義（build 後の dist）を使う。
import { CONFIG_YAML_OPTIONS, normalizeDBType } from './dist/model/ConfigYaml.js';

// config.yml 読み込み
const configFilePath = path.join('config', 'config.yml');
const config = load(fs.readFileSync(configFilePath, 'utf-8'), CONFIG_YAML_OPTIONS);
config.dbtype = normalizeDBType(config.dbtype);

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
            // 設定どおりの journal 方式を接続の直後に明示する（sqlite.wal が true なら WAL、それ以外は delete）。
            prepareDatabase: db => {
                db.pragma(`journal_mode = ${config.sqlite?.wal === true ? 'WAL' : 'DELETE'}`);
            },
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
            // ssl は設定されたときだけ渡す。省略時は TLS を使わず接続する。
            ...(typeof config.mysql.ssl === 'undefined' ? {} : { ssl: config.mysql.ssl }),
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
