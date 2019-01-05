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

interface IPCServerEncodingProgramgStatusUpdateMessage {
    msg: string;
    recordedId: number;
}

namespace IPCMessageDefinition {
    export const getTuners = 'getTuners';
    export const getReserveAllId = 'getReserveAllId';
    export const getReserve = 'getReserve';
    export const getReserves = 'getReserves';
    export const getReserveConflicts = 'getReserveConflicts';
    export const getReserveSkips = 'getReserveSkips';
    export const getReserveOverlaps = 'getReserveOverlaps';
    export const getReservePosition = 'getReservePosition';
    export const addReserve  = 'addReserve';
    export const editReserve  = 'editReserve';
    export const cancelReserve = 'cancelReserve';
    export const removeReserveSkip = 'removeReserveSkip';
    export const disableReserveOverlap = 'disableReserveOverlap';
    export const recordedDelete = 'recordedDelete';
    export const recordedDeletes = 'recordedDeletes';
    export const recordedFileDelete = 'recordedFileDelete';
    export const recordedEncodeFileDelete = 'recordedEncodeFileDelete';
    export const recordedDeleteRule = 'recordedDeleteRule';
    export const recordedDeleteRules = 'recordedDeleteRules';
    export const recordedClenaup = 'recordedClenaup';
    export const recordedRegenerateThumbnail = 'recordedRegenerateThumbnail';
    export const ruleDisable = 'ruleDisable';
    export const ruleEnable = 'ruleEnable';
    export const ruleDelete = 'ruleDelete';
    export const ruleDeletes = 'ruleDeletes';
    export const ruleAdd = 'ruleAdd';
    export const ruleUpdate = 'ruleUpdate';
    export const addEncodeFile = 'addEncodeFile';
    export const addRecordedExternalFile = 'addRecordedExternalFile';
    export const createNewRecorded = 'createNewRecorded';
    export const updateTsFileSize = 'updateTsFileSize';
    export const updateEncodedFileSize = 'updateEncodedFileSize';
    export const updateReserves = 'updateReserves';
    export const setEncodeToClient = 'setEncodeToClient';
    export const updateEncodingProgramgStatusToClient = 'updateEncodingProgramgStatusToClient';
}

export { IPCClientMessage, IPCServerMessage, IPCServerSocketIoMessage, IPCServerEncodeMessage, IPCServerEncodingProgramgStatusUpdateMessage, IPCMessageDefinition };

