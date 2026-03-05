/**
 * Tests for Gateway caller authentication middleware.
 *
 * Verifies API key + IP allowlist enforcement,
 * exempt paths, and edge cases.
 */
import { describe, test, expect } from "bun:test"
import { Hono } from "hono"
import { createAuthMiddleware, safeCompare } from "../src/middleware/auth.ts"

/** Create a test app with auth middleware configured */
function createAuthTestApp(apiKey: string, allowedIps: string[]) {
  const app = new Hono()

  app.use(
    "*",
    createAuthMiddleware({
      apiKey,
      allowedIps: new Set(allowedIps),
      exemptPaths: new Set(["/health"]),
    }),
  )

  // Test routes
  app.get("/health", (c) => c.json({ status: "ok" }))
  app.post("/proxy", (c) => c.json({ message: "proxy works" }))
  app.get("/admin/credentials", (c) => c.json({ message: "admin works" }))

  return app
}

const TEST_API_KEY = "test-laurin-api-key-for-testing-purposes-only"
const GATEWAY_IP = "100.112.204.112"

describe("safeCompare", () => {
  test("returns true for matching strings", () => {
    expect(safeCompare("hello", "hello")).toBe(true)
    expect(safeCompare(TEST_API_KEY, TEST_API_KEY)).toBe(true)
  })

  test("returns false for non-matching strings", () => {
    expect(safeCompare("hello", "world")).toBe(false)
    expect(safeCompare("abc", "abd")).toBe(false)
  })

  test("returns false for different lengths", () => {
    expect(safeCompare("short", "longer-string")).toBe(false)
    expect(safeCompare("", "notempty")).toBe(false)
  })
})

describe("auth middleware", () => {
  const app = createAuthTestApp(TEST_API_KEY, [GATEWAY_IP])

  test("allows health endpoint without auth", async () => {
    const res = await app.request("/health")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
  })

  test("rejects requests without Authorization header", async () => {
    const res = await app.request("/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
  })

  test("rejects requests with wrong API key", async () => {
    const res = await app.request("/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-key",
      },
    })
    expect(res.status).toBe(401)
  })

  test("rejects requests with malformed Authorization header", async () => {
    const res = await app.request("/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic dXNlcjpwYXNz",
      },
    })
    expect(res.status).toBe(401)
  })

  test("rejects requests with empty Bearer token", async () => {
    const res = await app.request("/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer ",
      },
    })
    expect(res.status).toBe(401)
  })

  test("allows requests with correct API key (IP check relaxed for app.request)", async () => {
    // Note: Hono's app.request() doesn't set a real remote IP,
    // so the IP will be "unknown" which passes IP check
    const res = await app.request("/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe("proxy works")
  })

  test("allows admin routes with correct API key", async () => {
    const res = await app.request("/admin/credentials", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
      },
    })
    expect(res.status).toBe(200)
  })

  test("rejects requests from disallowed IPs", async () => {
    // Simulate a request with a known bad IP via X-Forwarded-For
    const res = await app.request("/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_API_KEY}`,
        "X-Real-Ip": "203.0.113.50",
      },
    })
    // The middleware checks IP first, so this should be 403
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("Forbidden")
  })

  test("allows requests from Gateway IP via X-Real-Ip", async () => {
    const res = await app.request("/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_API_KEY}`,
        "X-Real-Ip": GATEWAY_IP,
      },
    })
    expect(res.status).toBe(200)
  })
})

describe("auth middleware disabled", () => {
  test("when no auth middleware, all routes are open", async () => {
    const app = new Hono()
    app.post("/proxy", (c) => c.json({ message: "open" }))

    const res = await app.request("/proxy", { method: "POST" })
    expect(res.status).toBe(200)
  })
})
