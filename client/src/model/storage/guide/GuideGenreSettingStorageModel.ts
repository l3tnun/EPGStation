import { inject, injectable } from 'inversify';
import AbstractStorageBaseModel from '../AbstractStorageBaseModel';
import IStorageOperationModel from '../IStorageOperationModel';
import { IGuideGenreSettingStorageModel, IGuideGenreSettingValue } from './IGuideGenreSettingStorageModel';

@injectable()
export default class GuideGenreSettingStorageModel extends AbstractStorageBaseModel<IGuideGenreSettingValue> implements IGuideGenreSettingStorageModel {
    constructor(@inject('IStorageOperationModel') op: IStorageOperationModel) {
        super(op);
    }

    public getDefaultValue(): IGuideGenreSettingValue {
        return {
            0: true,
            1: true,
            2: true,
            3: true,
            4: true,
            5: true,
            6: true,
            7: true,
            8: true,
            9: true,
            10: true,
            11: true,
            12: true,
            13: true,
            14: true,
            15: true,
        };
    }

    public getStorageKey(): string {
        return 'GuideGenreSetting';
    }
}
