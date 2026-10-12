import { readdirSync } from 'node:fs'
import { join } from 'node:path'

export function listTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      return listTsxFiles(path)
    }

    return entry.isFile() && path.endsWith('.tsx') ? [path] : []
  })
}

export function listCssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      return listCssFiles(path)
    }

    return entry.isFile() && path.endsWith('.css') ? [path] : []
  })
}
