// Service 子 process の代わり。本物の IPCClient と本物の SocketIOManageModel を、実 HTTP server の上で動かす。
// operator 側から届いた IPC message は 1 件ずつ stdout へ JSON の 1 行で記録する（IPC の channel は operator との
// 通信だけに使うので、観測は stdout に出す）。
const http = require('node:http');
const { join } = require('node:path');

require('reflect-metadata');

const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (typeof snapshot !== 'string' || typeof process.send !== 'function') process.exit(90);

const IPCClient = require(join(snapshot, 'model/ipc/IPCClient.js')).default;
const SocketIOManageModel = require(join(snapshot, 'model/service/socketio/SocketIOManageModel.js')).default;

const logger = { system: { error: () => undefined, fatal: () => undefined, info: () => undefined } };
const record = value => process.stdout.write(`${JSON.stringify(value)}\n`);

const server = http.createServer();
const socketIO = new SocketIOManageModel({ getLogger: () => logger }, { getConfig: () => ({}) });
socketIO.initialize([server]);
new IPCClient({ getLogger: () => logger }, socketIO, { push: () => undefined });
process.on('message', message => record({ event: 'ipc', at: Date.now(), message }));

server.listen(0, '127.0.0.1', () => record({ event: 'listening', port: server.address().port }));
