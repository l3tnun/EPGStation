import ILogger from './ILogger';

export default interface ILoggerModel {
    initialize(filePath?: string): void;
    getLogger(): ILogger;
}
