import * as child_process from 'child_process';
import * as path from 'path';
import Operator from './Operator/Operator';
import factory from './Model/ModelFactory'
import { IPCServerInterface } from './Model/IPC/IPCServer';

new Operator().run()
.then(() => {
    let child = child_process.fork(path.join(__dirname, 'Service', 'ServiceExecutor.js'), [], { silent: true });

    // Operator と Service 間通信の設定
    let ipc: IPCServerInterface = <IPCServerInterface>(factory.get('IPCServer'));
    ipc.register(child);
})
.catch((err) => {
    console.error(err);
});

