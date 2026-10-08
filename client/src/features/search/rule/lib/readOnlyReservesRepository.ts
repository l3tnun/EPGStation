import type { ReservesApiRepository } from '@/features/reserves/reservesApi'

export const READ_ONLY_RESERVES_API_REPOSITORY: ReservesApiRepository = {
  fetchReserves: async () => ({ ok: false, error: 'reserves-fetch-failed', message: '' }),
  fetchManualReserve: async () => ({
    ok: false,
    error: 'manual-reserve-fetch-failed',
    message: '',
  }),
  fetchManualProgram: async () => ({
    ok: false,
    error: 'manual-program-fetch-failed',
    message: '',
  }),
  addManualReserve: async () => ({
    ok: false,
    error: 'manual-reserve-add-failed',
    message: '',
  }),
  updateManualReserve: async () => ({
    ok: false,
    error: 'manual-reserve-update-failed',
    message: '',
  }),
  deleteReserve: async () => ({ ok: false, error: 'reserve-delete-failed', message: '' }),
  unlockSkipReserve: async () => ({ ok: false, error: 'unlock-skip-failed', message: '' }),
  unlockOverlapReserve: async () => ({ ok: false, error: 'unlock-overlap-failed', message: '' }),
  updateReserves: async () => ({ ok: false, error: 'reserves-update-failed', message: '' }),
}
