import StorageTemplateModel from '../Storage/StorageTemplateModel';

interface SettingValue {
    isAutoOpenNavigation: boolean;
    isEnabledPageMovementAnimation: boolean;
    programFixScroll: boolean;
    programMinimumDrawing: boolean;
    programLength: number;
    recordedLength: number;
    reservesLength: number;
    ruleLength: number;
    isEnableMegTsStreamingURLScheme: boolean;
    customMegTsStreamingURLScheme: string | null;
    isEnableRecordedViewerURLScheme: boolean;
    prioritizeWebPlayerOverURLScheme: boolean;
    customRecordedViewerURLScheme: string | null;
    isEnableRecordedDownloaderURLScheme: boolean;
    customRecordedDownloaderURLScheme: string | null;
}

/**
 * Setting Model
 */
class SettingModel extends StorageTemplateModel<SettingValue> {
    /**
     * get storage key
     * @return string;
     */
    protected getStorageKey(): string {
        return 'setting';
    }

    /**
     * set default value
     */
    public getDefaultValue(): SettingValue {
        return {
            isAutoOpenNavigation: true,
            isEnabledPageMovementAnimation: true,
            programFixScroll: false,
            programMinimumDrawing: false,
            programLength: 24,
            recordedLength: 24,
            reservesLength: 24,
            ruleLength: 24,
            isEnableMegTsStreamingURLScheme: true,
            customMegTsStreamingURLScheme: null,
            isEnableRecordedViewerURLScheme: true,
            prioritizeWebPlayerOverURLScheme: false,
            customRecordedViewerURLScheme: null,
            isEnableRecordedDownloaderURLScheme: true,
            customRecordedDownloaderURLScheme: null,
        };
    }
}

export { SettingValue, SettingModel };

