import * as child_process from 'child_process';
import * as path from 'path';
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

new Operator().run()
.then(() => {
    runService();
})
.catch((err) => {
    console.error(err);
});

