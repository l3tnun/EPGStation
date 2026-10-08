'use strict';

// 孫プロセスを作る hook command の代役。直接の子（この process）と孫の pid を記録して動き続ける。
// 孫は親が終わっても生き残る（別の process group にはしない）。
const { spawn } = require('node:child_process');
const { appendFileSync } = require('node:fs');

const [log] = process.argv.slice(2);
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { stdio: 'ignore' });
appendFileSync(log, `direct:${process.pid}\ngrandchild:${grandchild.pid}\n`);
setInterval(() => undefined, 1_000);
