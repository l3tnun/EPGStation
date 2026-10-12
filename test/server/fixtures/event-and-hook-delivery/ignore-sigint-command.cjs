'use strict';

const { appendFileSync } = require('node:fs');

const [signalLog] = process.argv.slice(2);

appendFileSync(signalLog, `started:${process.pid}\n`);
process.on('SIGINT', () => appendFileSync(signalLog, 'SIGINT\n'));
setInterval(() => undefined, 1_000);
