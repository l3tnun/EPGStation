import * as child_process from 'child_process';
import * as path from 'path';
import Configuration from './Configuration';
import ConnectionChecker from './ConnectionChecker';
import DBRevisionChecker from './DBRevisionChecker';
import { Logger } from './Logger';
import { IPCServerInterface } from './Model/IPC/IPCServer';
import MainModelFactorySetting from './Model/MainModelFactorySetting';
import factory from './Model/ModelFactory';
import Operator from './Operator/Operator';

Logger.initialize(path.join(__dirname, '..', '..', 'config', 'operatorLogConfig.json'));
Configuration.getInstance().initialize(path.join(__dirname, '..', '..', 'config', 'config.json'), true);

const log = Logger.getLogger();

// set git & uid
if (process.platform !== 'win32' && process.getuid() === 0) {
    const config = Configuration.getInstance().getConfig();

    // gid
    if (typeof config.gid === 'string' || typeof config.gid === 'number') {
        process.setgid(config.gid);
    } else {
        process.setgid('video');
    }

    // uid
    if (typeof config.uid === 'string' || typeof config.uid === 'number') {
        process.setuid(config.uid);
    }
}

const runService = (): void => {
    const child = child_process.fork(path.join(__dirname, 'Service', 'ServiceExecutor.js'), [], { silent: true });

    // Operator と Service 間通信の設定
    (<IPCServerInterface> factory.get('IPCServer')).register(child);

    // 終了したら再起動
    child.once('exit', () => {
        log.system.fatal('service process is down');
        log.system.fatal('restart service');
        runService();
    });
    child.once('error', () => { runService(); });

    // buffer が埋まらないようにする
    if (child.stdout !== null) { child.stdout.on('data', () => { }); }
    if (child.stderr !== null) { child.stderr.on('data', () => { }); }
};

// set models
MainModelFactorySetting.init();

(async(): Promise<void> => {
    try {
        const checker = new ConnectionChecker();
        await checker.checkMirakurun();
        await checker.checkDB();
        await new DBRevisionChecker().run();
        await new Operator().run();
        runService();
    } catch (err) {
        console.error(err);
    }
})();

