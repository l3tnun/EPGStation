const { join } = require('node:path');

require('reflect-metadata');

const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (typeof snapshot !== 'string' || typeof process.send !== 'function') process.exit(90);
const IPCClient = require(join(snapshot, 'model/ipc/IPCClient.js')).default;
const logger = {
    system: {
        fatal: value => process.send({ observation: 'fatal', value: String(value) }),
        info: () => undefined,
        error: () => undefined,
    },
};
new IPCClient(
    { getLogger: () => logger },
    { notifyClient: () => process.send({ observation: 'notifyClient' }) },
    { push: value => process.send({ observation: 'pushEncode', value }) },
);
process.send({ observation: 'ready' });
