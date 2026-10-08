export class ThrowingStorage implements Storage {
  get length(): number {
    return 0
  }

  clear(): void {
    throw new Error('storage unavailable')
  }

  getItem(): string | null {
    throw new Error('storage unavailable')
  }

  key(): string | null {
    return null
  }

  removeItem(): void {
    throw new Error('storage unavailable')
  }

  setItem(): void {
    throw new Error('storage unavailable')
  }
}

export class WriteFailingStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    if (key === 'settings') {
      throw new Error('quota exceeded')
    }

    this.values.set(key, value)
  }

  seed(key: string, value: string): void {
    this.values.set(key, value)
  }
}
