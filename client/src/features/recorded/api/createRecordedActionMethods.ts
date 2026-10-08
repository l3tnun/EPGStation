import type { ServerApiFetch } from '@/app/serverApi'
import { fetchAction } from './recordedFetch'
import { joinEndpoint } from './recordedAdapters'
import type { RecordedApiRepository } from './recordedApiTypes'

export function createRecordedActionMethods({
  fetcher,
  basePath,
}: {
  fetcher: ServerApiFetch
  basePath: string
}): Pick<
  RecordedApiRepository,
  | 'protectRecorded'
  | 'unprotectRecorded'
  | 'deleteRecorded'
  | 'deleteVideoFile'
  | 'cleanupRecorded'
  | 'cleanupThumbnails'
  | 'addEncode'
  | 'stopEncode'
  | 'sendVideoFileToKodi'
> {
  return {
    async protectRecorded(recordedId) {
      const ok = await fetchAction(
        fetcher,
        joinEndpoint(basePath, `/recorded/${recordedId}/protect`),
        {
          method: 'PUT',
        },
      )
      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'protect-failed', message: '保護に失敗' }
    },

    async unprotectRecorded(recordedId) {
      const ok = await fetchAction(
        fetcher,
        joinEndpoint(basePath, `/recorded/${recordedId}/unprotect`),
        { method: 'PUT' },
      )
      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'unprotect-failed', message: '保護解除に失敗' }
    },

    async deleteRecorded(recordedId) {
      const ok = await fetchAction(fetcher, joinEndpoint(basePath, `/recorded/${recordedId}`), {
        method: 'DELETE',
      })
      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'delete-failed', message: '削除に失敗' }
    },

    async deleteVideoFile(videoFileId) {
      const ok = await fetchAction(fetcher, joinEndpoint(basePath, `/videos/${videoFileId}`), {
        method: 'DELETE',
      })
      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'delete-failed', message: '削除に失敗' }
    },

    async cleanupRecorded() {
      const ok = await fetchAction(fetcher, joinEndpoint(basePath, '/recorded/cleanup'), {
        method: 'POST',
      })
      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'cleanup-failed', message: 'クリーンアップに失敗' }
    },

    async cleanupThumbnails() {
      const ok = await fetchAction(fetcher, joinEndpoint(basePath, '/thumbnails/cleanup'), {
        method: 'POST',
      })
      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'cleanup-failed', message: 'クリーンアップに失敗' }
    },

    async addEncode(body) {
      const ok = await fetchAction(fetcher, joinEndpoint(basePath, '/encode'), {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'add-encode-failed', message: 'エンコード追加に失敗しました' }
    },

    async stopEncode(recordedId) {
      const ok = await fetchAction(
        fetcher,
        joinEndpoint(basePath, `/recorded/${recordedId}/encode`),
        {
          method: 'DELETE',
        },
      )
      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'stop-encode-failed', message: 'エンコード停止に失敗' }
    },

    async sendVideoFileToKodi(body) {
      const ok = await fetchAction(
        fetcher,
        joinEndpoint(basePath, `/videos/${body.videoFileId}/kodi`),
        {
          body: JSON.stringify({ kodiName: body.kodiName }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
      )
      return ok
        ? { ok: true, value: undefined }
        : {
            ok: false,
            error: 'send-video-file-to-kodi-failed',
            message: '送信に失敗しました',
          }
    },
  }
}
