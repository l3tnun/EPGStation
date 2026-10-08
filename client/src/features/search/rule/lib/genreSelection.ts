type GenreSelection = { genre: number; subGenre?: number }

function removeGenreSelections(selectedGenres: readonly GenreSelection[], genre: number) {
  return selectedGenres.filter((item) => item.genre !== genre)
}

export function isTopGenreSelected(selectedGenres: readonly GenreSelection[], genre: number) {
  return selectedGenres.some((item) => item.genre === genre && item.subGenre === undefined)
}

export function selectedSubGenreIndexes(selectedGenres: readonly GenreSelection[], genre: number) {
  return selectedGenres
    .flatMap((item) => (item.genre === genre && item.subGenre !== undefined ? [item.subGenre] : []))
    .sort((a, b) => a - b)
}

export function toggleTopGenreSelection({
  selectedGenres,
  genre,
  subGenreCount,
  isSubGenreVisible,
}: {
  selectedGenres: readonly GenreSelection[]
  genre: number
  subGenreCount: number
  isSubGenreVisible: boolean
}) {
  const isSelected =
    isTopGenreSelected(selectedGenres, genre) ||
    (isSubGenreVisible &&
      subGenreCount > 0 &&
      selectedSubGenreIndexes(selectedGenres, genre).length === subGenreCount)

  return isSelected
    ? removeGenreSelections(selectedGenres, genre)
    : [...removeGenreSelections(selectedGenres, genre), { genre }]
}

export function toggleSubGenreSelection({
  selectedGenres,
  genre,
  subGenre,
  subGenreCount,
}: {
  selectedGenres: readonly GenreSelection[]
  genre: number
  subGenre: number
  subGenreCount: number
}) {
  const withoutGenre = removeGenreSelections(selectedGenres, genre)
  const selectedSubGenres = isTopGenreSelected(selectedGenres, genre)
    ? Array.from({ length: subGenreCount }, (_, index) => index).filter(
        (index) => index !== subGenre,
      )
    : selectedSubGenreIndexes(selectedGenres, genre).includes(subGenre)
      ? selectedSubGenreIndexes(selectedGenres, genre).filter((index) => index !== subGenre)
      : [...selectedSubGenreIndexes(selectedGenres, genre), subGenre]

  if (selectedSubGenres.length === 0) {
    return withoutGenre
  }

  if (selectedSubGenres.length === subGenreCount) {
    return [...withoutGenre, { genre }]
  }

  return [
    ...withoutGenre,
    ...selectedSubGenres
      .sort((a, b) => a - b)
      .map((selectedSubGenre) => ({ genre, subGenre: selectedSubGenre })),
  ]
}
