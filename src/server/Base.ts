import Configuration from './Configuration';
import { Logger } from './Logger';

abstract class Base {
    protected config: Configuration = Configuration.getInstance();
    protected log = Logger.getLogger();
}

export default Base;

