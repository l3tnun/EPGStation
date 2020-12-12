import * as socketIo from 'socket.io-client';

export const UPDATE_EVENT = 'updateStatus';

export default interface ISocketIOModel {
    Iinitialize(): void;
    getIO(): SocketIOClient.Socket | null;
    onUpdateState(callback: () => void): void;
    offUpdateState(callback: () => void): void;
    onUpdateEncodeState(callback: () => void): void;
    offUpdateEncodeState(callback: () => void): void;
}
