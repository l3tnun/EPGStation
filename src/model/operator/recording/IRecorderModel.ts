import Reserve from '../../../db/entities/Reserve';

export type RecorderModelProvider = () => Promise<IRecorderModel>;

export default interface IRecorderModel {
    setTimer(reserve: Reserve): boolean;
    cancel(isPlanToDelete: boolean): Promise<void>;
    update(newReserve: Reserve): Promise<void>;
    resetTimer(): boolean;
}
