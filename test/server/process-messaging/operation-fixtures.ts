export interface OperationCase {
    readonly args?: Record<string, unknown>;
    readonly domain: string;
    readonly func: string;
    readonly handlerArgs: readonly unknown[];
    readonly invoke: (client: any) => Promise<unknown>;
    readonly model: string;
    readonly result?: unknown;
}

const option = { name: 'synthetic-option' };
const rule = { id: 71, name: 'synthetic-rule' };
const info = { mode: 'synthetic-mode', recordedId: 81, videoFileId: 82 };

export const operationCases: readonly OperationCase[] = [
    {
        domain: 'reservation',
        func: 'getBroadcastStatus',
        handlerArgs: [],
        invoke: client => client.reserveation.getBroadcastStatus(),
        model: 'reserveation',
        result: { isBroadcasting: false },
    },
    {
        args: { option },
        domain: 'reservation',
        func: 'add',
        handlerArgs: [option],
        invoke: client => client.reserveation.add(option),
        model: 'reserveation',
        result: 101,
    },
    ...(['update', 'cancel', 'removeSkip', 'removeOverlap'] as const).map(func => ({
        args: { reserveId: 11 },
        domain: 'reservation',
        func,
        handlerArgs: [11],
        invoke: (client: any) => client.reserveation[func](11),
        model: 'reserveation',
    })),
    {
        args: { ruleId: 71 },
        domain: 'reservation',
        func: 'updateRule',
        handlerArgs: [71],
        invoke: client => client.reserveation.updateRule(71),
        model: 'reserveation',
    },
    {
        args: { isUntilComplete: true },
        domain: 'reservation',
        func: 'updateAll',
        handlerArgs: [],
        invoke: client => client.reserveation.updateAll(true),
        model: 'reserveation',
    },
    {
        args: { option, reserveId: 11 },
        domain: 'reservation',
        func: 'edit',
        handlerArgs: [11, option],
        invoke: client => client.reserveation.edit(11, option),
        model: 'reserveation',
    },
    {
        args: { recordedId: 21 },
        domain: 'recorded',
        func: 'delete',
        handlerArgs: [21],
        invoke: client => client.recorded.delete(21),
        model: 'recorded',
    },
    {
        args: { videoFileId: 22 },
        domain: 'recorded',
        func: 'updateVideoFileSize',
        handlerArgs: [22],
        invoke: client => client.recorded.updateVideoFileSize(22),
        model: 'recorded',
    },
    {
        args: { option },
        domain: 'recorded',
        func: 'addVideoFile',
        handlerArgs: [option],
        invoke: client => client.recorded.addVideoFile(option),
        model: 'recorded',
        result: 102,
    },
    {
        args: { option },
        domain: 'recorded',
        func: 'addUploadedVideoFile',
        handlerArgs: [option],
        invoke: client => client.recorded.addUploadedVideoFile(option),
        model: 'recorded',
    },
    {
        args: { isIgnoreProtection: undefined, option },
        domain: 'recorded',
        func: 'createNewRecorded',
        handlerArgs: [option],
        invoke: client => client.recorded.createNewRecorded(option),
        model: 'recorded',
        result: 103,
    },
    {
        args: { videoFileId: 22 },
        domain: 'recorded',
        func: 'deleteVideoFile',
        handlerArgs: [22],
        invoke: client => client.recorded.deleteVideoFile(22),
        model: 'recorded',
    },
    {
        args: { isProtect: true, recordedId: 21 },
        domain: 'recorded',
        func: 'changeProtect',
        handlerArgs: [21, true],
        invoke: client => client.recorded.changeProtect(21, true),
        model: 'recorded',
    },
    ...(['videoFileCleanup', 'dropLogFileCleanup'] as const).map(func => ({
        domain: 'recorded',
        func,
        handlerArgs: [],
        invoke: (client: any) => client.recorded[func](),
        model: 'recorded',
    })),
    {
        args: { color: '#123456', name: 'synthetic-tag' },
        domain: 'recordedTag',
        func: 'create',
        handlerArgs: ['synthetic-tag', '#123456'],
        invoke: client => client.recordedTag.create('synthetic-tag', '#123456'),
        model: 'recordedTag',
        result: 104,
    },
    {
        args: { color: '#123456', name: 'synthetic-tag', tagId: 31 },
        domain: 'recordedTag',
        func: 'update',
        handlerArgs: [31, 'synthetic-tag', '#123456'],
        invoke: client => client.recordedTag.update(31, 'synthetic-tag', '#123456'),
        model: 'recordedTag',
    },
    ...(['setRelation', 'deleteRelation'] as const).map(func => ({
        args: { recordedId: 21, tagId: 31 },
        domain: 'recordedTag',
        func,
        handlerArgs: [31, 21],
        invoke: (client: any) => client.recordedTag[func](31, 21),
        model: 'recordedTag',
    })),
    {
        args: { tagId: 31 },
        domain: 'recordedTag',
        func: 'delete',
        handlerArgs: [31],
        invoke: client => client.recordedTag.delete(31),
        model: 'recordedTag',
    },
    {
        domain: 'recording',
        func: 'resetTimer',
        handlerArgs: [],
        invoke: client => client.recording.resetTimer(),
        model: 'recording',
    },
    {
        args: { rule },
        domain: 'rule',
        func: 'add',
        handlerArgs: [rule],
        invoke: client => client.rule.add(rule),
        model: 'rule',
        result: 105,
    },
    {
        args: { rule },
        domain: 'rule',
        func: 'update',
        handlerArgs: [rule],
        invoke: client => client.rule.update(rule),
        model: 'rule',
    },
    ...(['enable', 'disable', 'delete'] as const).map(func => ({
        args: { ruleId: 71 },
        domain: 'rule',
        func,
        handlerArgs: [71],
        invoke: (client: any) => client.rule[func](71),
        model: 'rule',
    })),
    ...(['regenerate', 'fileCleanup'] as const).map(func => ({
        domain: 'thumbnail',
        func,
        handlerArgs: [],
        invoke: (client: any) => client.thumbnail[func](),
        model: 'thumbnail',
    })),
    {
        args: { videoFileId: 22 },
        domain: 'thumbnail',
        func: 'add',
        handlerArgs: [22],
        invoke: client => client.thumbnail.add(22),
        model: 'thumbnail',
    },
    {
        args: { thumbnailId: 41 },
        domain: 'thumbnail',
        func: 'delete',
        handlerArgs: [41],
        invoke: client => client.thumbnail.delete(41),
        model: 'thumbnail',
    },
    {
        args: { info },
        domain: 'encode',
        func: 'emitFinishEncode',
        handlerArgs: [info],
        invoke: client => client.encodeEvent.emitFinishEncode(info),
        model: 'encodeEvent',
    },
] as const;

export const operationKey = ({ model, func }: OperationCase): string => `${model}.${func}`;

export const domainHandlerSpies = (domains: Record<string, Record<string, unknown>>): any[] =>
    Object.values(domains).flatMap(domain => Object.values(domain));
