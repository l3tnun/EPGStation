import { EncodeProgram } from '../Service/Encode/EncodeManageModel';

/**
* IPC 通信で使用する message の 定義
*/
interface IPCClientMessage {
    id: number;
    msg: string;
    value?: any;
}

interface IPCServerMessage {
    id: number;
    value?: any;
    error?: string;
}

interface IPCServerSocketIoMessage {
    msg: string;
    value?: any;
}

interface IPCServerEncodeMessage {
    msg: string;
    program: EncodeProgram;
}

namespace IPCMessageDefinition {
    export const getReserveAllId = 'getReserveAllId';
    export const getReserves = 'getReserves';
    export const getReserveConflicts = 'getReserveConflicts';
    export const getReserveSkips = 'getReserveSkips';
    export const addReserve  = 'addReserve';
    export const cancelReserve = 'cancelReserve';
    export const removeReserveSkip = 'removeReserveSkip';
    export const recordedDelete = 'recordedDelete';
    export const ruleDisable = 'ruleDisable';
    export const ruleEnable = 'ruleEnable';
    export const ruleDelete = 'ruleDelete';
    export const ruleAdd = 'ruleAdd';
    export const ruleUpdate = 'ruleUpdate';
    export const addEncodeFile = 'addEncodeFile';
    export const setEncodeToClient = 'setEncodeToClient';
    export const updateReserves = 'updateReserves';
}

export { IPCClientMessage, IPCServerMessage, IPCServerSocketIoMessage, IPCServerEncodeMessage, IPCMessageDefinition };

