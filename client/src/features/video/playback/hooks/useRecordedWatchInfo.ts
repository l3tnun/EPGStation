import { useQuery } from '@tanstack/react-query'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { RecordedApiRepository, RecordedListItem } from '@/features/recorded/recordedApi'
import type {
  resolveRecordedStreamingWatchRoute,
  resolveRecordedWatchRoute,
} from '../playbackRoutes'
import { RECORDED_WATCH_INFO_QUERY_KEY } from '../recordedWatchRequests'

export function resolveRecordedPlaybackFileType({
  item,
  videoFileId,
}: {
  item: RecordedListItem | null | undefined
  videoFileId: number
}): 'ts' | 'encoded' | 'unknown' {
  const videoFile = item?.videoFiles?.find((file) => file.id === videoFileId)

  return videoFile?.type === 'ts' || videoFile?.type === 'encoded' ? videoFile.type : 'unknown'
}

export function useRecordedWatchInfo({
  route,
  isHalfWidthDisplayed,
  apiRepository,
  onSnackbar,
}: {
  route:
    | ReturnType<typeof resolveRecordedWatchRoute>
    | ReturnType<typeof resolveRecordedStreamingWatchRoute>
  isHalfWidthDisplayed: boolean
  apiRepository: RecordedApiRepository
  onSnackbar: (snackbar: ShellSnackbarState) => void
}) {
  const recordedId = route.ok && route.value.shouldRenderInfoCard ? route.value.recordedId : null

  return useQuery({
    queryKey: [...RECORDED_WATCH_INFO_QUERY_KEY, recordedId, isHalfWidthDisplayed],
    enabled: recordedId !== null,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const result = await apiRepository.fetchRecordedDetail({
        recordedId: recordedId ?? 0,
        isHalfWidth: isHalfWidthDisplayed,
      })

      if (!result.ok) {
        onSnackbar({ text: '番組情報取得に失敗', severity: 'error' })
        return null
      }

      return result.value
    },
  })
}
