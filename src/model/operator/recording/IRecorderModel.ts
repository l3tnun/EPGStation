import Reserve from '../../../db/entities/Reserve';

export type RecorderModelProvider = () => Promise<IRecorderModel>;

export default interface IRecorderModel {
    setTimer(reserve: Reserve, isSuppressLog: boolean): boolean;
    cancel(isPlanToDelete: boolean): Promise<void>;
    update(newReserve: Reserve, isSuppressLog: boolean): Promise<void>;
    resetTimer(): boolean;
}
