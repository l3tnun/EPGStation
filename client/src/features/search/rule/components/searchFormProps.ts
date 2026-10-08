import type { Dispatch, SetStateAction } from 'react'
import type { SearchFormState } from '../query'

export interface SearchFormFieldProps {
  form: SearchFormState
  setForm: Dispatch<SetStateAction<SearchFormState>>
}
