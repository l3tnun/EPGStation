import * as http from 'http';

export default interface ISocketIOManageModel {
    initialize(server: http.Server): void;
    notifyClient(): void;
}
