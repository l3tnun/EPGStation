'use strict';

require('reflect-metadata');

const { join } = require('node:path');

const snapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (snapshot === undefined) throw new Error('The compiled server snapshot is required');
const mode = process.argv[2];
const EPGUpdateEvent = require(join(snapshot, 'model', 'event', 'EPGUpdateEvent.js')).default;
const event = new EPGUpdateEvent({
    getLogger: () => ({
        system: {
            error: failure => {
                throw failure;
            },
        },
    }),
});

if (mode === 'pending') {
    event.setUpdated(() => {
        process.stdout.write('callback:pending\n');
        return new Promise(() => {});
    });
    event.emitUpdated();
    process.stdout.write('emit:return\n');
} else if (mode === 'no-emit') {
    event.setUpdated(() => process.stdout.write('callback:restored\n'));
    process.stdout.write('process:idle\n');
} else if (mode === 'fresh-emit') {
    event.setUpdated(() => process.stdout.write('callback:fresh\n'));
    event.emitUpdated();
    process.stdout.write('emit:return\n');
} else {
    throw new Error(`Unknown restart fixture mode: ${String(mode)}`);
}
