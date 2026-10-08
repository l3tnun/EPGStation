import { describe, expect, it } from 'vitest';

import { createRunnerDouble, loadEntity } from './db-unit-fakes';
import { immediateRetry, loadCompiled, repositoryOperator } from './repository-harness';
import { silentLoggerModel } from '../harness/silent-logger-model';

const Rule = loadEntity('Rule');
const RuleDB =
    loadCompiled<new (...arguments_: any[]) => { restore(items: object[]): Promise<void> }>('model/db/RuleDB.js');

const baseRule = (saveOption: object) => ({
    id: 1,
    updateCnt: 0,
    isTimeSpecification: false,
    searchOption: { keyword: 'k' },
    reserveOption: { enable: true, allowEndLack: true, avoidDuplicate: false },
    saveOption,
});

const restoreRows = async (saveOption: object) => {
    const double = createRunnerDouble();
    const repository = new RuleDB(silentLoggerModel, repositoryOperator({ createQueryRunner: () => double.runner }), immediateRetry);
    await repository.restore([baseRule(saveOption)]);
    return double.runner.manager.insert.mock.calls as unknown as [unknown, Record<string, unknown>][];
};

describe('RuleDB restore save option conversion (unittest/imp)', () => {
    it('[2.2] stores a null for every save option field the rule leaves undefined', async () => {
        const [[entity, row]] = await restoreRows({});

        expect(entity).toBe(Rule);
        expect(row).toMatchObject({ parentDirectoryName: null, directory: null, recordedFormat: null });
    });

    it('[2.2] stores a null for the directory and format when only the parent directory is given', async () => {
        const [[, row]] = await restoreRows({ parentDirectoryName: 'recorded' });

        expect(row).toMatchObject({ parentDirectoryName: 'recorded', directory: null, recordedFormat: null });
    });

    it('[2.2] keeps every save option field the rule defines', async () => {
        const [[, row]] = await restoreRows({
            parentDirectoryName: 'recorded',
            directory: 'drama',
            recordedFormat: '%TITLE%',
        });

        expect(row).toMatchObject({ parentDirectoryName: 'recorded', directory: 'drama', recordedFormat: '%TITLE%' });
    });
});
