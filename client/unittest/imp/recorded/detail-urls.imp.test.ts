import { describe, expect, it } from 'vitest'
import {
  buildRecordedDetailRequestUrl,
  buildVideoDownloadUrl,
  buildVideoPlaylistUrl,
  buildVideoUrlSchemeHandoffUrl,
} from '@/features/recorded/recordedRequests'

describe('Recorded detail implementation edges', () => {
  it('builds detail, download, and playlist API URLs without double base path joining', () => {
    expect(
      buildRecordedDetailRequestUrl({
        recordedId: 301,
        isHalfWidth: false,
        basePath: '/api',
      }),
    ).toBe('/api/recorded/301?isHalfWidth=false')
    expect(buildVideoDownloadUrl({ videoFileId: 701 })).toBe('./api/videos/701?isDownload=true')
    expect(buildVideoPlaylistUrl({ videoFileId: 701 })).toBe('./api/videos/701/playlist')
  })

  it('uses URL scheme only when enabled and replaces placeholders without storing real hosts', () => {
    expect(
      buildVideoUrlSchemeHandoffUrl({
        shouldUseUrlScheme: false,
        urlScheme: 'synthetic://ADDRESS',
        videoFileId: 701,
        filename: 'synthetic.ts',
        mode: 'download',
        origin: 'https://example.invalid',
      }),
    ).toBeNull()
    expect(
      buildVideoUrlSchemeHandoffUrl({
        shouldUseUrlScheme: true,
        urlScheme: 'synthetic://PROTOCOL/ADDRESS/FILENAME',
        videoFileId: 701,
        filename: 'synthetic.ts',
        mode: 'download',
        origin: 'https://example.invalid',
      }),
    ).toBe('synthetic://https/example.invalid/api/videos/701?isDownload=true/synthetic.ts')
    expect(
      buildVideoUrlSchemeHandoffUrl({
        shouldUseUrlScheme: true,
        urlScheme: 'vlc-x-callback://x-callback-url/stream?url=PROTOCOL://ADDRESS',
        videoFileId: 701,
        filename: 'synthetic.ts',
        mode: 'download',
        origin: 'https://example.invalid',
      }),
    ).toBe(
      'vlc-x-callback://x-callback-url/stream?url=https://example.invalid%2Fapi%2Fvideos%2F701%3FisDownload%3Dtrue',
    )
  })

  it('reproduces the exact vlc-x-callback URL for a user-configured iOS download scheme (urlscheme.download.ios is no longer shipped with this value by default; see the empty-default test below)', () => {
    // iOS 側の VLC は path (/stream or /download) で action を決め、"&" で区切った各 key=value を
    // 個別に percent-decode する (videolan/vlc-ios Sources/Helpers/Network/URLHandler.swift の
    // XCallbackURLHandler.performOpen / VLCURLHandler.parseURL)。action が /download でないと
    // ダウンロードではなく再生（stream）扱いになる。この template 自体は利用者が
    // config.yml の urlscheme.download.ios に明示的に設定した場合の挙動確認用であり、
    // 既定値ではない（実機検証の結果、VLC 経由のダウンロードは保存ファイル名が Base64
    // 化されるため、iOS 向け download URL scheme は既定で設定しない方針になった）。
    const userConfiguredIOSDownloadTemplate =
      'vlc-x-callback://x-callback-url/download?url=PROTOCOL%3A%2F%2FADDRESS&filename=FILENAME'

    const url = buildVideoUrlSchemeHandoffUrl({
      shouldUseUrlScheme: true,
      urlScheme: userConfiguredIOSDownloadTemplate,
      videoFileId: 701,
      filename: 'sample.ts',
      mode: 'download',
      origin: 'https://example.invalid',
    })

    expect(url).toBe(
      'vlc-x-callback://x-callback-url/download?url=https%3A%2F%2Fexample.invalid%2Fapi%2Fvideos%2F701%3FisDownload%3Dtrue&filename=sample.ts',
    )

    const [urlEntry, filenameEntry] = (url ?? '').split('?')[1].split('&')
    expect(decodeURIComponent(urlEntry.replace('url=', ''))).toBe(
      'https://example.invalid/api/videos/701?isDownload=true',
    )
    expect(decodeURIComponent(filenameEntry.replace('filename=', ''))).toBe('sample.ts')
  })

  it('falls back to null (direct download URL) when no iOS download scheme is configured, matching the shipped empty default (config.yml.template / Configuration.DEFAULT_VALUE urlscheme.download has no ios)', () => {
    // urlscheme.download.ios が config.yml に設定されていない場合、サーバーの /api/config は
    // download.ios を含まない (undefined) ため、client の recordedDownloadUrlScheme も
    // undefined/null になる。そのとき buildVideoUrlSchemeHandoffUrl は null を返し、
    // 呼び出し側 (RecordedDownloadDialog) は buildVideoDownloadUrl() の直接ダウンロード URL を使う。
    for (const emptyScheme of [undefined, null, '']) {
      const url = buildVideoUrlSchemeHandoffUrl({
        shouldUseUrlScheme: true,
        urlScheme: emptyScheme,
        videoFileId: 701,
        filename: 'sample.ts',
        mode: 'download',
        origin: 'https://example.invalid',
      })

      expect(url).toBeNull()
    }

    expect(buildVideoDownloadUrl({ videoFileId: 701 })).toBe('./api/videos/701?isDownload=true')
  })
})
