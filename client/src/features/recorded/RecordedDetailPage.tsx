import Button from '@mui/material/Button'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { SHELL_NAVIGATION_DRAWER_ID } from '@/app/AppShell'
import { useScrollHistoryPageReady } from '@/app/scrollHistory'
import { TitleBar } from '@/app/titleBar'
import {
  buildRecordedPlaybackHandoffTarget,
  createRecordedDetailQueryKey,
} from './recordedRequests'
import type { RecordedHandoffVideoFile } from './recordedRequests'
import styles from './RecordedPage.module.css'
import {
  formatRecordedDetailGenres,
  formatRecordedDetailTime,
  formatRecordedDropInfo,
  hasRecordedDropError,
} from './lib/recordedFormat'
import { RecordedDetailVideoFileMenu } from './components/RecordedDetailVideoFileMenu'
import { getBrowserHref } from './lib/recordedBrowser'
import { DropLogDialog, RecordedDetailMoreMenu } from './components/RecordedDetailMoreMenu'
import { AddEncodeDialog } from './components/AddEncodeDialog'
import { parseRecordedDetailRouteId } from './lib/recordedRoute'
import { RecordedStreamSelectDialog } from './components/RecordedStreamSelectDialog'
import type { RecordedPageProps } from './recordedPageProps'
import { openSnackbar } from './lib/recordedSnackbar'
import { SendVideoFileToKodiDialog } from './components/SendVideoFileToKodiDialog'
import { RecordedExtendedText } from './components/RecordedDownloadDialog'
import { RecordedThumbnail } from './components/RecordedListItemView'
import { EMPTY_STRING_LIST } from './lib/emptyList'

export function RecordedDetailPage({
  isNavigationOpen,
  onNavigationClick,
  settings,
  apiRepository,
  onFetchFailure,
  isEncodeEnabled = false,
  encodeModes = EMPTY_STRING_LIST,
  recordedDirectories = EMPTY_STRING_LIST,
  kodiHosts = EMPTY_STRING_LIST,
  streamConfig,
  recordedViewUrlScheme,
  recordedDownloadUrlScheme,
}: RecordedPageProps) {
  const params = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [isEncodeOpen, setEncodeOpen] = useState(false)
  const [isKodiOpen, setKodiOpen] = useState(false)
  const [isDropLogOpen, setDropLogOpen] = useState(false)
  const [streamFile, setStreamFile] = useState<RecordedHandoffVideoFile | null>(null)
  const [dropLogContent, setDropLogContent] = useState<string | null>(null)
  const handledRouteKey = useRef<string | undefined>(undefined)
  const recordedId = parseRecordedDetailRouteId(params.id)
  const isValidRecordedId = recordedId !== null
  const request = useMemo(
    () => ({ recordedId: recordedId ?? 0, isHalfWidth: settings.isHalfWidthDisplayed }),
    [recordedId, settings.isHalfWidthDisplayed],
  )
  const query = useQuery({
    enabled: isValidRecordedId,
    queryKey: createRecordedDetailQueryKey(request),
    queryFn: () => apiRepository.fetchRecordedDetail(request),
  })
  const routeKey = location.pathname
  useScrollHistoryPageReady(
    !isValidRecordedId || (query.data !== undefined && !query.isFetching),
    routeKey,
  )

  useEffect(() => {
    if (
      !isValidRecordedId ||
      query.data === undefined ||
      query.isFetching ||
      handledRouteKey.current === routeKey
    ) {
      return
    }

    handledRouteKey.current = routeKey
    if (!query.data.ok) {
      onFetchFailure({
        text: query.data.message,
        severity: 'error',
      })
    }
  }, [isValidRecordedId, onFetchFailure, query.data, query.isFetching, routeKey])

  const item = query.data?.ok === true ? query.data.value : undefined
  const label = item?.name ?? ''
  const videoFiles = item?.videoFiles ?? []
  const recordedStreamConfig = streamConfig?.recorded
  const streamableVideoFiles = videoFiles.filter(
    (file) =>
      (file.type === 'ts' && recordedStreamConfig?.ts !== undefined) ||
      (file.type === 'encoded' && recordedStreamConfig?.encoded !== undefined),
  )
  const genreLabels = item === undefined ? [] : formatRecordedDetailGenres(item)
  const dropInfo = item === undefined ? null : formatRecordedDropInfo(item)
  const showDropLog = async () => {
    const dropLogFileId = item?.dropLogFile?.id
    if (dropLogFileId === undefined) {
      return
    }
    const result = await apiRepository.fetchDropLog({ dropLogFileId, maxsize: 512 })
    if (result.ok) {
      setDropLogContent(result.value)
      setDropLogOpen(true)
      return
    }
    openSnackbar(onFetchFailure, 'ログファイル取得に失敗しました', 'error')
  }
  const stopEncode = async () => {
    if (item?.id === undefined) return
    const result = await apiRepository.stopEncode(item.id)
    if (result.ok) {
      openSnackbar(onFetchFailure, 'エンコード停止')
      void query.refetch()
      return
    }
    openSnackbar(onFetchFailure, 'エンコード停止に失敗', 'error')
  }
  const buildPlaybackTarget = (file: RecordedHandoffVideoFile) =>
    buildRecordedPlaybackHandoffTarget({
      recordedId: item?.id,
      file,
      settings,
      browserHref: getBrowserHref(),
      recordedViewUrlScheme,
    })
  const playVideoFile = (file: RecordedHandoffVideoFile) => {
    const target = buildPlaybackTarget(file)

    if (!target.ok) {
      openSnackbar(onFetchFailure, target.message, 'error')
      return
    }

    if (target.kind === 'route') {
      navigate(target.to)
      return
    }
  }

  return (
    <>
      <TitleBar
        title="録画詳細"
        isNavigationOpen={isNavigationOpen}
        navigationControlsId={SHELL_NAVIGATION_DRAWER_ID}
        onNavigationClick={onNavigationClick}
        rightActions={
          item !== undefined ? (
            <RecordedDetailMoreMenu
              item={item}
              settings={settings}
              apiRepository={apiRepository}
              recordedDownloadUrlScheme={recordedDownloadUrlScheme}
              onSnackbar={onFetchFailure}
              onDeletedAllFiles={() => navigate(-1)}
            />
          ) : undefined
        }
      />
      {item !== undefined ? (
        <section
          className={`${styles.recordedPage} ${styles.recordedDetailPage}`}
          data-testid="recorded-detail-page"
        >
          <div className={styles.detailHero} data-testid="recorded-detail-hero">
            <RecordedThumbnail item={item} label={label} />
            <div>
              <h2 className={styles.itemTitle}>{label}</h2>
              <p className={styles.itemChannelMeta}>
                {item.channelName ?? (item.channelId === undefined ? '' : `${item.channelId}`)}
              </p>
              {genreLabels.map((genre) => (
                <p key={genre} className={styles.itemSubMeta}>
                  {genre}
                </p>
              ))}
              {formatRecordedDetailTime(item) !== '' ? (
                <p className={styles.itemSubMeta}>{formatRecordedDetailTime(item)}</p>
              ) : undefined}
              {item.dropLogFile !== undefined && dropInfo !== null ? (
                <button
                  className={styles.detailDropButton}
                  data-has-drop-error={String(hasRecordedDropError(item))}
                  type="button"
                  onClick={() => void showDropLog()}
                >
                  {dropInfo}
                </button>
              ) : undefined}
              <div className={styles.actionRow}>
                {videoFiles.length > 0 ? (
                  <RecordedDetailVideoFileMenu
                    title="play"
                    icon="󰐊"
                    files={videoFiles}
                    onSelect={playVideoFile}
                    hrefForFile={(file) => {
                      const target = buildPlaybackTarget(file)
                      return target.ok && target.kind === 'href' ? target.href : undefined
                    }}
                  />
                ) : undefined}
                {streamableVideoFiles.length > 0 ? (
                  <RecordedDetailVideoFileMenu
                    title="streaming"
                    icon="󰐌"
                    files={streamableVideoFiles}
                    onSelect={setStreamFile}
                  />
                ) : undefined}
                {item.isRecording !== true && isEncodeEnabled ? (
                  <Button
                    className={styles.detailEncodeAction}
                    data-recorded-detail-action="encode"
                    type="button"
                    onClick={() => setEncodeOpen(true)}
                  >
                    <span aria-hidden="true" className={styles.detailActionIcon}>
                      󰐙
                    </span>
                    encode
                  </Button>
                ) : undefined}
                {item.isEncoding === true ? (
                  <Button
                    className={styles.detailStopAction}
                    data-recorded-detail-action="stop"
                    type="button"
                    onClick={() => void stopEncode()}
                  >
                    <span aria-hidden="true" className={styles.detailActionIcon}>
                      󰓛
                    </span>
                    stop
                  </Button>
                ) : undefined}
                {item.isRecording !== true && kodiHosts.length > 0 ? (
                  <Button
                    className={styles.detailKodiAction}
                    data-recorded-detail-action="kodi"
                    type="button"
                    onClick={() => setKodiOpen(true)}
                  >
                    <span aria-hidden="true" className={styles.detailActionIcon}>
                      󰄘
                    </span>
                    kodi
                  </Button>
                ) : undefined}
              </div>
            </div>
          </div>
          <p className={styles.itemDescription}>{item.description}</p>
          <RecordedExtendedText text={item.extended} />
          <AddEncodeDialog
            item={item}
            open={isEncodeOpen}
            encodeModes={encodeModes}
            recordedDirectories={recordedDirectories}
            apiRepository={apiRepository}
            onClose={() => setEncodeOpen(false)}
            onSnackbar={onFetchFailure}
          />
          <SendVideoFileToKodiDialog
            open={isKodiOpen}
            item={item}
            hosts={kodiHosts}
            apiRepository={apiRepository}
            onClose={() => setKodiOpen(false)}
            onSnackbar={onFetchFailure}
          />
          <DropLogDialog
            open={isDropLogOpen}
            title={label}
            content={dropLogContent}
            onClose={() => setDropLogOpen(false)}
          />
          <RecordedStreamSelectDialog
            open={streamFile !== null}
            item={item}
            file={streamFile}
            streamConfig={streamConfig}
            onClose={() => setStreamFile(null)}
            onNavigate={(path) => navigate(path)}
            onSnackbar={onFetchFailure}
          />
        </section>
      ) : null}
    </>
  )
}
