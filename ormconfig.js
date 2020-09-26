const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// config.yml 読み込み
const configFilePath = path.join('config', 'config.yml');
const config = yaml.safeLoad(fs.readFileSync(configFilePath, 'utf-8'));

// dist 下のディレクトリ設定
const distDBBasePath = path.join('dist', 'db');
const entitie = path.join(distDBBasePath, 'entities', '**', '*.js');
const subscriber = path.join(distDBBasePath, 'subscribers', '**', '*.js');

// src 下のディレクトリ設定
const srcDBBasePath = path.join('src', 'db');
const entitiesDir = path.join(srcDBBasePath, 'entities');
const subscribersDir = path.join(srcDBBasePath, 'subscribers');

// ormconfig
const ormConfig = {
    synchronize: false,
    logging: false,
    entities: [entitie],
    subscribers: [subscriber],
    migrationsRun: true,
    cli: {
        entitiesDir: entitiesDir,
        subscribersDir: subscribersDir,
    },
};

// database の種類に応じた設定
switch (config.dbtype) {
    case 'sqlite':
        ormConfig.type = 'sqlite';
        ormConfig.database = path.join(__dirname, 'data', 'database.db');
        break;

    case 'mysql':
        ormConfig.type = 'mysql';
        ormConfig.host = config.mysql.host;
        ormConfig.port = config.mysql.port;
        ormConfig.username = config.mysql.user;
        ormConfig.password = config.mysql.password;
        ormConfig.database = config.mysql.database;
        ormConfig.bigNumberStrings = false;
        break;

    case 'postgres':
        ormConfig.type = 'postgres';
        ormConfig.host = config.postgres.host;
        ormConfig.port = config.postgres.port;
        ormConfig.username = config.postgres.user;
        ormConfig.password = config.postgres.password;
        ormConfig.database = config.postgres.database;
        break;

    default:
        throw new Error('db config error');
}

// database の種類に応じた migration ファイルパスの設定
ormConfig.migrations = [path.join(distDBBasePath, 'migrations', config.dbtype, '**', '*.js')];
ormConfig.cli.migrationsDir = path.join(srcDBBasePath, 'migrations', config.dbtype);

module.exports = ormConfig;
