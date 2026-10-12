import Button from '@mui/material/Button'
import { AppSelect } from '@/shared/AppSelect'
import {
  isTopGenreSelected,
  selectedSubGenreIndexes,
  toggleSubGenreSelection,
  toggleTopGenreSelection,
} from '../lib/genreSelection'
import { parseNumberInput } from '../lib/inputParsers'
import { SEARCH_GENRE_ITEMS } from '../lib/searchFormItems'
import styles from '../SearchRulePage.module.css'
import { SearchCheckbox } from './SearchCheckbox'
import type { SearchFormFieldProps } from './searchFormProps'

export function SearchGenreRow({
  form,
  setForm,
  isSubGenreVisible,
  setSubGenreVisible,
}: SearchFormFieldProps & {
  isSubGenreVisible: boolean
  setSubGenreVisible: (isVisible: boolean) => void
}) {
  return (
    <div className={styles.searchRow}>
      <span className={styles.searchLabel}>ジャンル</span>
      <div className={styles.searchControl}>
        <AppSelect
          ariaLabel="genre"
          className={`${styles.textInput} ${styles.selectLikeInput}`}
          value={form.genre ?? ''}
          showEmptyOptionLabel
          options={[
            { label: 'すべて', value: '' },
            ...SEARCH_GENRE_ITEMS.map(([genre], genreIndex) => ({
              label: genre,
              value: genreIndex,
            })),
          ]}
          onChange={(value) =>
            setForm((current) => ({
              ...current,
              genre: parseNumberInput(value),
            }))
          }
        />
        <div className={styles.genrePreview}>
          {SEARCH_GENRE_ITEMS.flatMap(([genre, subGenres], genreIndex) =>
            form.genre !== null && form.genre !== genreIndex
              ? []
              : [
                  <div key={`${genre}-${genreIndex}`}>
                    <button
                      className={styles.genreItem}
                      data-selected={String(isTopGenreSelected(form.selectedGenres, genreIndex))}
                      type="button"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          selectedGenres: toggleTopGenreSelection({
                            selectedGenres: current.selectedGenres,
                            genre: genreIndex,
                            subGenreCount: subGenres.length,
                            isSubGenreVisible,
                          }),
                        }))
                      }
                    >
                      {genre}
                    </button>
                    {isSubGenreVisible
                      ? subGenres.map((subGenre, subGenreIndex) => (
                          <button
                            className={`${styles.genreItem} ${styles.subGenreItem}`}
                            data-selected={String(
                              isTopGenreSelected(form.selectedGenres, genreIndex) ||
                                selectedSubGenreIndexes(form.selectedGenres, genreIndex).includes(
                                  subGenreIndex,
                                ),
                            )}
                            key={`${genre}-${subGenre}`}
                            type="button"
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                selectedGenres: toggleSubGenreSelection({
                                  selectedGenres: current.selectedGenres,
                                  genre: genreIndex,
                                  subGenre: subGenreIndex,
                                  subGenreCount: subGenres.length,
                                }),
                              }))
                            }
                          >
                            {subGenre}
                          </button>
                        ))
                      : null}
                  </div>,
                ],
          )}
        </div>
        <div className={styles.genreActions}>
          <SearchCheckbox
            checked={isSubGenreVisible}
            label="サブジャンル表示"
            onChange={(isChecked) => {
              setSubGenreVisible(isChecked)
              if (!isChecked) {
                setForm((current) => ({
                  ...current,
                  selectedGenres: Array.from(
                    new Set(current.selectedGenres.map((genre) => genre.genre)),
                    (genre) => ({ genre }),
                  ),
                }))
              }
            }}
          />
          <Button
            size="small"
            variant="contained"
            onClick={() => setForm((current) => ({ ...current, selectedGenres: [] }))}
          >
            クリア
          </Button>
        </div>
      </div>
    </div>
  )
}
