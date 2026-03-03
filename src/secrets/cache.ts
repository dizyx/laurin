/**
 * In-memory secret cache with TTL.
 * Secrets fetched from Infisical are cached here for 60s (configurable)
 * to avoid hitting the API on every proxy request.
 */

interface CacheEntry {
  value: string
  fetchedAt: number
}

export function createSecretCache(ttlMs: number) {
  const cache = new Map<string, CacheEntry>()

  return {
    get(key: string): string | null {
      const entry = cache.get(key)
      if (!entry) return null
      if (Date.now() - entry.fetchedAt > ttlMs) {
        cache.delete(key)
        return null
      }
      return entry.value
    },

    set(key: string, value: string): void {
      cache.set(key, { value, fetchedAt: Date.now() })
    },

    invalidate(key: string): void {
      cache.delete(key)
    },

    clear(): void {
      cache.clear()
    },

    size(): number {
      return cache.size
    },
  }
}

export type SecretCache = ReturnType<typeof createSecretCache>
