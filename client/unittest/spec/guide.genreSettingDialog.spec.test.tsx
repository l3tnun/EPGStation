import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GuideGenreSettingDialog } from '@/features/guide/components/GuideGenreSettingDialog'

describe('GuideGenreSettingDialog', () => {
  it('[AC 3.29] defaults a genre switch to checked when the visibility map omits that genre id', () => {
    render(<GuideGenreSettingDialog open visibility={{}} onClose={vi.fn()} onSave={vi.fn()} />)

    expect(screen.getByRole('switch', { name: 'ニュース・報道' })).toBeChecked()
  })

  it('[AC 3.21] renders all 16 genre switches for genre id 0 through 15, including genre 15 "その他"', () => {
    render(<GuideGenreSettingDialog open visibility={{}} onClose={vi.fn()} onSave={vi.fn()} />)

    expect(screen.getAllByRole('switch')).toHaveLength(16)
    expect(screen.getByRole('switch', { name: 'その他' })).toBeChecked()
  })
})
