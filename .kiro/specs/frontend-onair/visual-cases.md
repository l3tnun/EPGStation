# Visual Cases: 放映中

## 目的

On Air の visual regression は、broadcasting schedule card、ProgramDialog、LiveStreamSelectDialog、watch info card、responsive layout が live playback owner と矛盾しないことを検証する。

`design.md` の Visual Implementation Contract にある OnAirCard density、LiveStreamSelectDialog width/padding、watch info spacing を geometry assertion の正本にする。

## Layout Cases

| Case | Route / State | Viewport | Mock Dataset | Visual invariant |
| --- | --- | --- | --- | --- |
| onair-list-desktop | `/onair` loaded | 1440x900 | `onAirMixedChannels` | `OnAirCard` は centered max width 800 の single column として並び、channel/schedule ごとに 1 item 表示される。 |
| onair-list-mobile | `/onair` loaded | 390x844 | `onAirMixedChannels` | card text、metadata、action button が重ならず、horizontal overflow を発生させない。 |
| onair-program-dialog | program selected | 1440x900 | `onAirProgramDialog` | ProgramDialog は metadata、description、extended、予約状態別 action を表示し、close 後に remove/remount される。 |
| onair-stream-dialog | stream action selected | 1440x900 | `onAirStreamOptions` | LiveStreamSelectDialog は max width 400、stream type/config select、external app switch、`キャンセル` / `視聴` を表示する。 |
| onair-watch-info | `/onair/watch` with matching info | 1440x900 | `onAirWatchInfo` | player owner 領域と info card が centered max width 1200 内で共存し、info card が player controls を覆わない。 |
| onair-watch-autoplay | `/onair/watch` after stream dialog | 1440x900 | `onAirWatchInfo`, `onAirStreamOptions` | playback owner に autoplay/audio/subtitle contract を委譲し、watch page 遷移直後に player 領域が再生開始可能な state になる。 |
| onair-empty-error | `/onair` empty/error | 1440x900 | `onAirEmpty`, `onAirError` | empty/error state が追加の実データ文言を含まず、snackbar が layout を押し出さない。 |
| onair-dark | `/onair` and `/onair/watch` dark theme | 1440x900 | `onAirMixedChannels`, `onAirWatchInfo`, `settingsDarkTheme` | OnAirCard、ProgramDialog、LiveStreamSelectDialog、watch info card、action icon が dark theme token で表示される。watch info card は white surface fallback と dark surface 上の black foreground を残さない。 |

## Interaction / Geometry Cases

- `isOnAirTabListView` の値に応じた tab/list 表示差分は text overlap を起こさない。
- stream selection の保存済み type/mode が候補にない場合は先頭候補に補正され、dialog control の空白状態を出さない。
- unsupported stream combination の snackbar は dialog の action row を押し下げない。
- OnAirCard description は 2 行までを visual baseline とし、overflow は ellipsis または clipped text token に委譲する。category 表示は On Air card の visual contract に含めない。
- progress bar は theme token を App Shell に委譲し、fixture では progress value と layout stability だけを assertion する。
- `/onair/watch` の player controls は `frontend-video-playback` が所有し、On Air は info card と player owner 領域の spacing だけを検証する。
- `/onair/watch` 遷移直後の autoplay/audio/subtitle は `frontend-video-playback` の visual cases と同じ fixture で確認し、On Air は handoff state と info card spacing を固定する。
- live playback verification は entrypoint dialog からの M2TS external/playlist handoff と、direct route の M2TS/M2TS-LL/WebM/MP4/HLS player mapping を分けて証跡化する。M2TS direct route を外部 handoff の代表確認で省略してはならない。
- dark theme では ProgramDialog と LiveStreamSelectDialog の portal surface、select、action row、icon contrast を確認する。
- OnAirCard max width 800px、card padding 12px 16px、progress height 4px、stream dialog max width 400px、watch max width 1200px、info card は player の下で最大幅 800px とする。
