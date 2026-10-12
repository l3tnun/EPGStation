import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(join(process.cwd(), 'package.json'));
const compiledSnapshot = process.env.EPGSTATION_SERVER_COMPILED_SNAPSHOT;
if (compiledSnapshot === undefined) throw new Error('The compiled server snapshot is required');

type EventClass = Record<string, unknown> & (new (logger: unknown) => any);

const load = (file: string): EventClass =>
    (require(join(compiledSnapshot, 'model', 'event', file)) as { default: EventClass }).default;

const logger = { getLogger: () => ({ system: { error: vi.fn() } }) };

// 内部の event 名の定数。名前と値の綴りを固定し、emit 側と set 側が同じ定数を使うことを往復で確かめる。
const eventConstants = (eventClass: EventClass): Record<string, string> =>
    Object.fromEntries(Object.entries(eventClass).filter(([, value]) => typeof value === 'string')) as Record<
        string,
        string
    >;

describe('internal event names (unittest/imp)', () => {
    it('[EH-NAMES] RecordedEvent names every event with a correctly spelled constant', () => {
        expect(eventConstants(load('RecordedEvent.js'))).toEqual({
            DELETE_RECORDED_EVENT: 'DeleteRecorded',
            UPDATE_VIDEO_FILE_SIZE: 'UpdateVideoFileSize',
            CREATE_NEW_RECORDED: 'createNewRecorded',
            ADD_VIDEO_FILE: 'AddVideoFile',
            ADD_UPLOADED_VIDEO_FILE: 'addUploadedVideoFile',
            DELETE_VIDEO_FILE: 'DeleteVideoFile',
            DROP_LOG_FILE_CHANGED: 'DropLogFileChanged',
            CHANGE_PROTECT: 'ChangeProtect',
        });
    });

    it('[EH-NAMES] RecordingEvent names the preparation events with a correctly spelled constant', () => {
        expect(eventConstants(load('RecordingEvent.js'))).toEqual({
            START_PREP_RECORDING_EVENT: 'StartPrepRecording',
            CANCEL_PREP_RECORDING_EVENT: 'CancelPrepRecording',
            PREP_RECORDING_FAILED_EVENT: 'PrepRecordingFailed',
            START_RECORDING_EVENT: 'StartRecordingEvent',
            RECORDING_FAILED_EVENT: 'RecordingFailedEvent',
            RECORDING_RETRY_OVER_EVENT: 'RecordingRetryOverEvent',
            FINISH_RECORDING_EVENT: 'FinishRecordingEvent',
            EVENT_RELAY_EVENT: 'EventRelayEvent',
        });
    });

    it('[EH-NAMES] RecordedTagEvent names the relation event with a correctly spelled constant', () => {
        expect(eventConstants(load('RecordedTagEvent.js'))).toEqual({
            CREATED_EVENT: 'Created',
            UPDATED_EVENT: 'Updated',
            RELATED_EVENT: 'Related',
            DELETED_EVENT: 'Deleted',
            DELETED_RELATION_EVENT: 'DeletedRelation',
        });
    });

    it('[EH-NAMES] EncodeEvent names the progress event with a correctly spelled value', () => {
        expect(eventConstants(load('EncodeEvent.js'))).toEqual({
            ADD_ENCODE_EVENT: 'addEncodeEvent',
            CANCEL_ENCODE_EVENT: 'cancelEncodeEvent',
            FINISH_ENCODE_EVENT: 'finishEncodeEvent',
            ERROR_ENCODE_EVENT: 'errorEncodeEvent',
            UPDATE_ENCODE_EVENT: 'updateEncodeEvent',
            UPDATE_ENCODE_PROGRESS_EVENT: 'updateEncodeProgressEvent',
        });
    });

    it('[EH-NAMES] an emitted event reaches the listener set through the same constant', () => {
        const recorded = new (load('RecordedEvent.js'))(logger);
        const deleteVideoFile = vi.fn();
        recorded.setDeleteVideoFile(deleteVideoFile);
        recorded.emitDeleteVideoFile(7);
        expect(deleteVideoFile).toHaveBeenCalledExactlyOnceWith(7);

        const recording = new (load('RecordingEvent.js'))(logger);
        const startPrep = vi.fn();
        const cancelPrep = vi.fn();
        recording.setStartPrepRecording(startPrep);
        recording.setCancelPrepRecording(cancelPrep);
        recording.emitStartPrepRecording({ id: 1 });
        recording.emitCancelPrepRecording({ id: 2 });
        expect(startPrep).toHaveBeenCalledExactlyOnceWith({ id: 1 });
        expect(cancelPrep).toHaveBeenCalledExactlyOnceWith({ id: 2 });

        const tag = new (load('RecordedTagEvent.js'))(logger);
        const related = vi.fn();
        tag.setRelated(related);
        tag.emitRelated(3, 4);
        expect(related).toHaveBeenCalledExactlyOnceWith(3, 4);

        const encode = new (load('EncodeEvent.js'))(logger);
        const progress = vi.fn();
        encode.setUpdateEncodeProgress(progress);
        encode.emitUpdateEncodeProgress();
        expect(progress).toHaveBeenCalledOnce();
    });
});
