const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { DataSource } = require('typeorm');

// config.yml 読み込み
const configFilePath = path.join('config', 'config.yml');
const config = yaml.load(fs.readFileSync(configFilePath, 'utf-8'));

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
            type: 'sqlite',
            database: path.join(__dirname, 'data', 'database.db'),
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
            username: config.mysql.user,
            password: config.mysql.password,
            database: config.mysql.database,
            charset: typeof config.mysql.charset === 'undefined' ? 'utf8mb4' : config.mysql.charset,
            enable_ssl: config.mysql.enable_ssl,
            ca_path: config.mysql.ca_path || undefined,
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

module.exports = { ormConfig };
