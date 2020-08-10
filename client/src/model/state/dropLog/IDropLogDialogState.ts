import * as apid from '../../../../../api';

export default interface IDropLogDialogState {
    setName(name: string): void;
    fetchData(dropLogFileId: apid.DropLogFileId): Promise<void>;
    getName(): string;
    getDropLog(): string | null;
}
