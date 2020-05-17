import { ChildProcess } from 'child_process';
import * as apid from '../../../api';

export default interface IIPCServer {
    register(child: ChildProcess): void;
    notifyClient(): void;
    setEncode(addOption: apid.AddEncodeProgramOption): void;
}
