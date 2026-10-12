import { ExtendedPagination } from './ExtendedPagination'
import { LegacyPagination } from './LegacyPagination'

export interface AppPaginationProps {
  /** The `isEnableExtendedPagination` setting: `true` shows the extended pagination. */
  isEnableExtendedPagination: boolean
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

/**
 * The pagination every paged list screen uses. It is the one place that chooses between the
 * extended pagination and the legacy one from the `isEnableExtendedPagination` setting, so the
 * screens neither branch on the setting nor import either pagination themselves.
 */
export function AppPagination({ isEnableExtendedPagination, ...props }: AppPaginationProps) {
  return isEnableExtendedPagination ? (
    <ExtendedPagination {...props} />
  ) : (
    <LegacyPagination {...props} />
  )
}
