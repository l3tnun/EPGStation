import * as apid from '../../../../../api';

export default interface IRecordingApiModel {
    gets(option: apid.GetRecordedOption): Promise<apid.Records>;
}
