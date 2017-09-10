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
            log4js.configure(<any>{
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
            log4js.configure(logPath);
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

