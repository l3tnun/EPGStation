import * as path from 'path';
import * as fs from 'fs';
import * as log4js from 'log4js';

interface LoggerInterface {
    system: log4js.Logger;
    access: log4js.Logger;
    stream: log4js.Logger;
}

/**
* Logger
* log の出力を行う
*/
namespace Logger {
    let logger: LoggerInterface | null = null;

    /**
    * 初期化
    * @param logPath log file path
    */
    export const initialize = (logPath?: string): void => {
        if(typeof logPath == 'undefined') {
            log4js.configure({
                appenders: {
                    system: { type: 'console' },
                    access: { type: 'console' },
                    stream: { type: 'console' },
                    console: { type: 'console' },
                },
                categories: {
                    default: { appenders: [ 'console' ], level: 'info' },
                    system: { appenders: [ 'system', 'console' ], level: 'info' },
                    access: { appenders: [ 'access', 'console' ], level: 'info' },
                    stream: { appenders: [ 'stream', 'console' ], level: 'info' },
                }
            });
        } else {
            // read log file
            let str: string | null = null;
            try {
                str = fs.readFileSync(logPath, 'utf-8');
            } catch(e) {
                if(e.code === 'ENOENT') {
                    console.error('log file is not found.');
                } else {
                    console.error(e);
                }
            }
            if(str === null) { process.exit(1); }

            // replace path
            if(process.platform === 'win32') {
                str = str!.replace('%OperatorSystem%', path.join(__dirname, '..', '..', 'logs', 'Operator', 'system.log').replace(/\\/g, '\\\\'))
                    .replace('%OperatorAccess%', path.join(__dirname, '..', '..', 'logs', 'Operator', 'access.log').replace(/\\/g, '\\\\'))
                    .replace('%OperatorStream%', path.join(__dirname, '..', '..', 'logs', 'Operator', 'stream.log').replace(/\\/g, '\\\\'))
                    .replace('%ServiceSystem%', path.join(__dirname, '..', '..', 'logs', 'Service', 'system.log').replace(/\\/g, '\\\\'))
                    .replace('%ServiceAccess%', path.join(__dirname, '..', '..', 'logs', 'Service', 'access.log').replace(/\\/g, '\\\\'))
                    .replace('%ServiceStream%', path.join(__dirname, '..', '..', 'logs', 'Service', 'stream.log').replace(/\\/g, '\\\\'))
            } else {
                str = str!.replace('%OperatorSystem%', path.join(__dirname, '..', '..', 'logs', 'Operator', 'system.log'))
                    .replace('%OperatorAccess%', path.join(__dirname, '..', '..', 'logs', 'Operator', 'access.log'))
                    .replace('%OperatorStream%', path.join(__dirname, '..', '..', 'logs', 'Operator', 'stream.log'))
                    .replace('%ServiceSystem%', path.join(__dirname, '..', '..', 'logs', 'Service', 'system.log'))
                    .replace('%ServiceAccess%', path.join(__dirname, '..', '..', 'logs', 'Service', 'access.log'))
                    .replace('%ServiceStream%', path.join(__dirname, '..', '..', 'logs', 'Service', 'stream.log'))
            }

            try {
                const config: log4js.Configuration = JSON.parse(str);
                log4js.configure(config);
            } catch(err) {
                console.error('log file parse error');
                process.exit(1);
            }
        }

        logger = {
            system: log4js.getLogger('system'),
            access: log4js.getLogger('access'),
            stream: log4js.getLogger('stream')
        };
    }

    export const getLogger = (): LoggerInterface => {
        if(logger == null) { throw new Error('Please Logger initialize'); }
        return logger;
    }
}

export { LoggerInterface, Logger };

