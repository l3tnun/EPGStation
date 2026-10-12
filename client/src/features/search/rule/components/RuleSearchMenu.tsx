import Button from '@mui/material/Button'
import Menu from '@mui/material/Menu'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { ClearableTextField } from '@/shared/ClearableTextField'
import styles from '../SearchRulePage.module.css'

export function RuleSearchMenu({
  anchorEl,
  search,
  onClose,
  onSubmit,
}: {
  anchorEl: HTMLElement
  search: string
  onClose: () => void
  onSubmit: (path: string) => void
}) {
  const [keyword, setKeyword] = useState(() => new URLSearchParams(search).get('keyword') ?? '')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const submit = () => {
    const parameters = new URLSearchParams()
    if (keyword.length > 0) {
      parameters.set('keyword', keyword)
    }
    const query = parameters.toString()
    onSubmit(query.length === 0 ? '/rule' : `/rule?${query}`)
  }
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      submit()
    }
  }

  return (
    <Menu
      anchorEl={anchorEl}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      disableAutoFocusItem
      open
      onClose={onClose}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{
        list: {
          'aria-label': 'ルール検索',
          sx: { p: 0 },
        },
        paper: {
          sx: {
            maxWidth: 'calc(100vw - 32px)',
            width: 400,
            '@media (max-width: 430px)': {
              width: 312,
            },
          },
        },
      }}
    >
      <div className={styles.ruleSearchMenu} role="presentation">
        <div className={styles.ruleSearchFields}>
          <ClearableTextField
            autoFocus
            fullWidth
            inputRef={inputRef}
            label="キーワード"
            variant="standard"
            value={keyword}
            onClear={() => setKeyword('')}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={submitOnEnter}
          />
        </div>
        <div className={styles.ruleSearchActions}>
          <Button color="error" variant="text" onClick={onClose}>
            閉じる
          </Button>
          <Button color="primary" variant="text" onClick={submit}>
            検索
          </Button>
        </div>
      </div>
    </Menu>
  )
}
