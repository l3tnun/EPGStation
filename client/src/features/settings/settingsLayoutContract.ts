export const SETTINGS_CARD_MAX_WIDTH_PX = 800

export const SETTINGS_SECTION_ORDER = [
  '全般',
  '放映中',
  '番組表',
  '予約',
  '録画中',
  '録画',
  '検索',
  'ルール',
  'ページネーション',
  'ビデオプレーヤ',
] as const

export const SETTINGS_URL_SCHEME_PLACEHOLDER =
  'epgstation-synthetic-view://{content-id}/play?source={synthetic-source}&marker={synthetic-placeholder-marker}&return={synthetic-return-target}'
