import type { FeatureResult, ServerApiFetch } from '@/app/serverApi'
import type {
  AddEncodeRequestBody,
  RecordedDetailRequest,
  RecordedListRequest,
  RecordedUploadMetadataBody,
  RecordedUploadVideoRequest,
} from '../recordedRequests'

export interface RecordedVideoFile {
  id?: number
  name?: string
  filename?: string
  size?: number
  type?: string
  isOriginal?: boolean
}

export interface RecordedDropLogFile {
  id?: number
  dropCnt: number
  errorCnt: number
  scramblingCnt: number
}

export interface RecordedListItem {
  id?: number
  name?: string
  channelId?: number
  channelName?: string
  genres?: readonly string[]
  genre1?: number
  subGenre1?: number
  genre2?: number
  subGenre2?: number
  genre3?: number
  subGenre3?: number
  startAt?: number
  endAt?: number
  description?: string
  extended?: string
  ruleId?: number
  isProtected?: boolean
  isRecording?: boolean
  isEncoding?: boolean
  thumbnails?: readonly number[]
  dropLogFile?: RecordedDropLogFile
  videoFiles?: readonly RecordedVideoFile[]
}

export interface RecordedListResponse {
  records: RecordedListItem[]
  total: number
}

export interface RecordedSearchOptionItem {
  id: number
  name: string
  halfWidthName?: string
}

export interface RecordedRuleKeywordItem {
  id: number
  keyword: string
}

export interface RecordedRuleDetail {
  id: number
  keyword?: string
}

export interface RecordedSearchOptions {
  channels: readonly RecordedSearchOptionItem[]
  genres: readonly RecordedSearchOptionItem[]
}

export interface RecordedUploadCreatedResponse {
  recordedId: number
}

type ActionResult<E extends string> = Promise<FeatureResult<void, E>>

export interface RecordedApiRepository {
  primeChannelIndex?(channels: unknown): void
  fetchRecorded(
    request: RecordedListRequest,
  ): Promise<FeatureResult<RecordedListResponse, 'recorded-fetch-failed'>>
  fetchRecordedOptions(): Promise<FeatureResult<RecordedSearchOptions, 'recorded-options-failed'>>
  fetchRecordedUploadOptions?(): Promise<
    FeatureResult<RecordedSearchOptions, 'recorded-options-failed'>
  >
  fetchRuleKeywords(
    keyword?: string,
  ): Promise<FeatureResult<readonly RecordedRuleKeywordItem[], 'rule-keywords-failed'>>
  fetchRule(ruleId: number): Promise<FeatureResult<RecordedRuleDetail, 'rule-fetch-failed'>>
  fetchRecordedDetail(
    request: RecordedDetailRequest,
  ): Promise<FeatureResult<RecordedListItem, 'recorded-fetch-failed'>>
  fetchVideoDuration?(
    videoFileId: number,
  ): Promise<FeatureResult<number, 'video-duration-fetch-failed'>>
  fetchDropLog(request: {
    dropLogFileId: number
    maxsize: number
  }): Promise<FeatureResult<string, 'drop-log-fetch-failed'>>
  createRecorded(
    body: RecordedUploadMetadataBody,
  ): Promise<FeatureResult<RecordedUploadCreatedResponse, 'recorded-create-failed'>>
  uploadVideoFile(request: RecordedUploadVideoRequest): ActionResult<'video-upload-failed'>
  protectRecorded(recordedId: number): ActionResult<'protect-failed'>
  unprotectRecorded(recordedId: number): ActionResult<'unprotect-failed'>
  deleteRecorded(recordedId: number): ActionResult<'delete-failed'>
  deleteVideoFile(videoFileId: number): ActionResult<'delete-failed'>
  cleanupRecorded(): ActionResult<'cleanup-failed'>
  cleanupThumbnails(): ActionResult<'cleanup-failed'>
  addEncode(body: AddEncodeRequestBody): ActionResult<'add-encode-failed'>
  stopEncode(recordedId: number): ActionResult<'stop-encode-failed'>
  sendVideoFileToKodi(body: {
    videoFileId: number
    kodiName: string
  }): ActionResult<'send-video-file-to-kodi-failed'>
}

export interface CreateFetchRecordedApiRepositoryOptions {
  fetcher?: ServerApiFetch
  basePath?: string
}
