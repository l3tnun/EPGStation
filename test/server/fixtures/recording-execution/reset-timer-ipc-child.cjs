'use strict';

const { join } = require('node:path');

require('reflect-metadata');

const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (typeof snapshot !== 'string' || typeof process.send !== 'function') process.exit(90);

const IPCClient = require(join(snapshot, 'model', 'ipc', 'IPCClient.js')).default;
const logger = {
    system: {
        error() {},
        fatal() {},
        info() {},
    },
};
const client = new IPCClient({ getLogger: () => logger }, { notifyClient() {} }, { push() {} });

const report = observation => process.stdout.write(`${JSON.stringify(observation)}\n`);

process.on('message', message => {
    if (message?.type !== 'recording-reset-timer-test-start') return;
    const settle = label =>
        client.recording.resetTimer().then(
            () => report({ label, outcome: 'resolved', type: 'settled' }),
            error =>
                report({
                    error: error instanceof Error ? error.message : String(error),
                    label,
                    outcome: 'rejected',
                    type: 'settled',
                }),
        );
    void Promise.all([settle('first'), settle('second')]).then(() => {
        report({ pendingRequestCount: client.pending.size, type: 'terminal' });
        setImmediate(() => process.disconnect());
    });
});

report({ type: 'ready' });
