import { describe, expect, it } from 'vitest'
import {
  selectedSubGenreIndexes,
  toggleSubGenreSelection,
  toggleTopGenreSelection,
} from '@/features/search/rule/lib/genreSelection'

describe('searchRule genre selection toggling', () => {
  it('lists only sub genres of the requested genre, sorted', () => {
    expect(
      selectedSubGenreIndexes(
        [
          { genre: 1 },
          { genre: 2, subGenre: 3 },
          { genre: 1, subGenre: 4 },
          { genre: 1, subGenre: 0 },
        ],
        1,
      ),
    ).toEqual([0, 4])
  })

  it('does not treat a fully selected sub genre set as selected when sub genres are hidden', () => {
    expect(
      toggleTopGenreSelection({
        selectedGenres: [
          { genre: 1, subGenre: 0 },
          { genre: 1, subGenre: 1 },
        ],
        genre: 1,
        subGenreCount: 2,
        isSubGenreVisible: false,
      }),
    ).toEqual([{ genre: 1 }])
  })

  it('treats a fully selected visible sub genre set as selected and clears it', () => {
    expect(
      toggleTopGenreSelection({
        selectedGenres: [{ genre: 1, subGenre: 0 }, { genre: 1, subGenre: 1 }, { genre: 2 }],
        genre: 1,
        subGenreCount: 2,
        isSubGenreVisible: true,
      }),
    ).toEqual([{ genre: 2 }])
  })

  it('selects the top genre when nothing is selected even if the genre has no sub genres', () => {
    expect(
      toggleTopGenreSelection({
        selectedGenres: [],
        genre: 1,
        subGenreCount: 0,
        isSubGenreVisible: true,
      }),
    ).toEqual([{ genre: 1 }])
  })

  it('removes a selected sub genre while keeping the others', () => {
    expect(
      toggleSubGenreSelection({
        selectedGenres: [{ genre: 1, subGenre: 0 }, { genre: 1, subGenre: 1 }, { genre: 2 }],
        genre: 1,
        subGenre: 0,
        subGenreCount: 3,
      }),
    ).toEqual([{ genre: 2 }, { genre: 1, subGenre: 1 }])
  })

  it('removes the genre entirely when the last sub genre is deselected', () => {
    expect(
      toggleSubGenreSelection({
        selectedGenres: [{ genre: 1, subGenre: 0 }, { genre: 2 }],
        genre: 1,
        subGenre: 0,
        subGenreCount: 3,
      }),
    ).toEqual([{ genre: 2 }])
  })

  it('removes the genre when the top genre is toggled for a genre without sub genres', () => {
    expect(
      toggleSubGenreSelection({
        selectedGenres: [{ genre: 1 }],
        genre: 1,
        subGenre: 0,
        subGenreCount: 0,
      }),
    ).toEqual([])
  })

  it('expands a selected top genre into all other sub genres when one is deselected', () => {
    expect(
      toggleSubGenreSelection({
        selectedGenres: [{ genre: 1 }],
        genre: 1,
        subGenre: 1,
        subGenreCount: 3,
      }),
    ).toEqual([
      { genre: 1, subGenre: 0 },
      { genre: 1, subGenre: 2 },
    ])
  })

  it('collapses to the top genre when every sub genre becomes selected', () => {
    expect(
      toggleSubGenreSelection({
        selectedGenres: [
          { genre: 1, subGenre: 0 },
          { genre: 1, subGenre: 2 },
        ],
        genre: 1,
        subGenre: 1,
        subGenreCount: 3,
      }),
    ).toEqual([{ genre: 1 }])
  })
})
