export function resolveLegacyTitleBarMinHeight(viewportWidth: number): 56 | 64 {
  return viewportWidth >= 960 ? 64 : 56
}

export function resolveLegacyTitleBarMetrics() {
  return {
    toolbarPaddingX: 16,
    toolbarPaddingY: 4,
    navigationButtonMarginLeft: -12,
    navigationButtonSize: 48,
    titlePaddingLeft: 20,
  } as const
}

const legacyTitleBarMetrics = resolveLegacyTitleBarMetrics()

export const legacyTitleBarToolbarSx = {
  minHeight: `${resolveLegacyTitleBarMinHeight(0)}px !important`,
  px: `${legacyTitleBarMetrics.toolbarPaddingX}px`,
  py: `${legacyTitleBarMetrics.toolbarPaddingY}px`,
  '@media (min-width: 960px)': {
    minHeight: `${resolveLegacyTitleBarMinHeight(960)}px !important`,
  },
}
