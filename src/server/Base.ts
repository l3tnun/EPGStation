import Configuration from './Configuration';
import { Logger, LoggerInterface } from './Logger';

abstract class Base {
    protected config: Configuration = Configuration.getInstance();
    protected log: LoggerInterface = Logger.getLogger();
}

export default Base;

