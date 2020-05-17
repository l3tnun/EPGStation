import * as log4js from 'log4js';

export default interface ILogger {
    system: log4js.Logger;
    access: log4js.Logger;
    stream: log4js.Logger;
    encode: log4js.Logger;
}
