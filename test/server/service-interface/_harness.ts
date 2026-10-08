import 'reflect-metadata';

import { createRequire } from 'node:module';
import { once } from 'node:events';
import { join } from 'node:path';
import type { Server } from 'node:http';

export const require = createRequire(join(process.cwd(), 'package.json'));
export const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;

if (compiledSnapshot === undefined) {
    throw new Error('The compiled server snapshot is required');
}

export const compiled = (...segments: string[]): string => join(compiledSnapshot, ...segments);

export const modelContainer = (require(compiled('model', 'ModelContainer.js')) as any).default;

export const listen = async (server: Server): Promise<string> => {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('HTTP fixture did not bind TCP');
    const origin = new URL('http://synthetic.invalid');
    origin.hostname = '127.0.0.1';
    origin.port = String(address.port);
    return origin.origin;
};

export const close = (server: Server): Promise<void> =>
    new Promise((resolve, reject) => server.close(error => (error === undefined ? resolve() : reject(error))));
