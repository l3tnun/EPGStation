import * as http from 'http';

export default interface ISocketIOManageModel {
    initialize(servers: http.Server[]): void;
    notifyClient(): void;
    notifyHlsReady(streamId: number, startRequestId: string): void;
    notifyUpdateEncodeProgress(): void;
}
