'use strict';

// hook command の実プロセスの代役。起動を 1 行記録し、mode に応じて、すぐ終わる（record）、
// exit 1 で終わる（exit1）、SIGINT を受けるまで動き続ける（sleep）。SIGINT を受けたら記録して終わる。
const { appendFileSync } = require('node:fs');

const [log, mode = 'record'] = process.argv.slice(2);
const id = process.env.RESERVEID ?? process.env.RECORDEDID ?? '';
appendFileSync(log, `started:${process.pid}:${id}:${process.env.MODE ?? ''}\n`);
if (mode === 'exit1') {
    process.exit(1);
}
if (mode === 'sleep') {
    process.on('SIGINT', () => {
        appendFileSync(log, `SIGINT:${process.pid}\n`);
        process.exit(130);
    });
    setInterval(() => undefined, 1_000);
}
