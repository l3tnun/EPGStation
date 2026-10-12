'use strict';

const { writeFileSync } = require('node:fs');

const [output, ...args] = process.argv.slice(2);
writeFileSync(output, JSON.stringify({ args, env: process.env }), 'utf8');
