import * as child_process from 'child_process';
import * as path from 'path';
import { Logger } from './Logger';
import Configuration from './Configuration';
import DBRevisionChecker from './DBRevisionChecker';
import ConnectionChecker from './ConnectionChecker';
import MainModelFactorySetting from './Model/MainModelFactorySetting';
import Operator from './Operator/Operator';
import factory from './Model/ModelFactory'
import { IPCServerInterface } from './Model/IPC/IPCServer';

// set git & uid
if(process.platform !== 'win32' && process.getuid() === 0) {
    const config = require(path.join('..', '..', 'config', 'config.json'));

    // gid
    if(typeof config.gid === 'string' || typeof config.gid === 'number') {
        process.setgid(config.gid);
    } else {
        process.setgid('video');
    }

    // uid
    if(typeof config.uid === 'string' || typeof config.uid === 'number') {
        process.setuid(config.uid);
    }
}

const runService = () => {
    const child = child_process.fork(path.join(__dirname, 'Service', 'ServiceExecutor.js'), [], { silent: true });

    // Operator と Service 間通信の設定
    (<IPCServerInterface>factory.get('IPCServer')).register(child);

    // 終了したら再起動
    child.once('exit', () => { runService(); });
    child.once('error', () => { runService(); });
}

Logger.initialize(path.join(__dirname, '..', '..', 'config', 'operatorLogConfig.json'));
Configuration.getInstance().initialize(path.join(__dirname, '..', '..', 'config', 'config.json'));

// set models
MainModelFactorySetting.init();

(async () => {
    try {
        const checker = new ConnectionChecker();
        await checker.checkMirakurun();
        await checker.checkDB();
        await new DBRevisionChecker().run();
        await new Operator().run()
        runService();
    } catch(err) {
        console.error(err);
    }
})();

