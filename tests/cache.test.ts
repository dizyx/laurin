/**
 * Tests for the in-memory secret cache.
 */
import { describe, test, expect, beforeEach } from "bun:test"
import { createSecretCache } from "../src/secrets/cache.ts"

describe("SecretCache", () => {
  let cache: ReturnType<typeof createSecretCache>

  beforeEach(() => {
    cache = createSecretCache(1000) // 1 second TTL for tests
  })

  test("returns null for missing keys", () => {
    expect(cache.get("nonexistent")).toBeNull()
  })

  test("stores and retrieves values", () => {
    cache.set("my-key", "my-secret-value")
    expect(cache.get("my-key")).toBe("my-secret-value")
  })

  test("returns null after TTL expires", async () => {
    cache = createSecretCache(50) // 50ms TTL
    cache.set("short-lived", "value")
    expect(cache.get("short-lived")).toBe("value")

    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(cache.get("short-lived")).toBeNull()
  })

  test("invalidates a specific key", () => {
    cache.set("key-a", "value-a")
    cache.set("key-b", "value-b")

    cache.invalidate("key-a")
    expect(cache.get("key-a")).toBeNull()
    expect(cache.get("key-b")).toBe("value-b")
  })

  test("clears all cached values", () => {
    cache.set("key-1", "value-1")
    cache.set("key-2", "value-2")
    cache.set("key-3", "value-3")

    expect(cache.size()).toBe(3)
    cache.clear()
    expect(cache.size()).toBe(0)
    expect(cache.get("key-1")).toBeNull()
  })

  test("overwrites existing values", () => {
    cache.set("key", "old-value")
    cache.set("key", "new-value")
    expect(cache.get("key")).toBe("new-value")
  })

  test("reports correct size", () => {
    expect(cache.size()).toBe(0)
    cache.set("a", "1")
    cache.set("b", "2")
    expect(cache.size()).toBe(2)
  })
})
