/**
 * Tests for credential injection and response stripping.
 *
 * Uses httpbin.org as a real HTTP endpoint to verify the full
 * inject → proxy → strip cycle.
 */
import { describe, test, expect } from "bun:test"
import { injectAndProxy } from "../src/proxy/injector.ts"

describe("injectAndProxy", () => {
  test("injects Authorization header and redacts it from response body", async () => {
    // httpbin.org/headers echoes back the request headers — the secret
    // should be redacted in the response body
    const result = await injectAndProxy(
      "test-secret-token",
      "GET",
      "https://httpbin.org/headers",
    )

    expect(result.status).toBe(200)
    expect(result.latencyMs).toBeGreaterThan(0)

    // The response body should have the secret REDACTED
    // (httpbin echoes request headers back, redaction catches this)
    const body = result.body as { headers: Record<string, string> }
    expect(body.headers["Authorization"]).toBe("Bearer [REDACTED_BY_LAURIN]")
    expect(body.headers["Authorization"]).not.toContain("test-secret-token")
  })

  test("strips credential-related headers from response", async () => {
    const result = await injectAndProxy(
      "test-token",
      "GET",
      "https://httpbin.org/response-headers?Authorization=should-be-stripped&X-Custom=should-stay",
    )

    expect(result.status).toBe(200)
    // Authorization header should be stripped from the response
    expect(result.headers["authorization"]).toBeUndefined()
    // Custom headers should pass through
    expect(result.headers["x-custom"]).toBe("should-stay")
  })

  test("forwards request body for POST requests", async () => {
    const result = await injectAndProxy(
      "test-token",
      "POST",
      "https://httpbin.org/post",
      undefined,
      { message: "hello from laurin" },
    )

    expect(result.status).toBe(200)
    const body = result.body as { json: { message: string } }
    expect(body.json.message).toBe("hello from laurin")
  })

  test("forwards custom headers (non-auth)", async () => {
    const result = await injectAndProxy(
      "test-token",
      "GET",
      "https://httpbin.org/headers",
      { "X-Agent-Id": "test-agent" },
    )

    expect(result.status).toBe(200)
    const body = result.body as { headers: Record<string, string> }
    expect(body.headers["X-Agent-Id"]).toBe("test-agent")
  })

  test("does NOT forward agent's Authorization header", async () => {
    // Even if the agent tries to sneak in an auth header, it should be overwritten
    // with the real token (which then gets redacted in the httpbin echo response)
    const result = await injectAndProxy(
      "real-token-value-here",
      "GET",
      "https://httpbin.org/headers",
      { Authorization: "Bearer agent-sneaky-token" },
    )

    expect(result.status).toBe(200)
    const body = result.body as { headers: Record<string, string> }
    // Should be the REAL token (redacted), not the agent's attempt
    expect(body.headers["Authorization"]).toBe("Bearer [REDACTED_BY_LAURIN]")
    // Agent's fake token should NOT appear
    expect(body.headers["Authorization"]).not.toContain("agent-sneaky-token")
  })

  test("handles non-JSON responses", async () => {
    const result = await injectAndProxy(
      "test-token",
      "GET",
      "https://httpbin.org/html",
    )

    expect(result.status).toBe(200)
    expect(typeof result.body).toBe("string")
    expect((result.body as string)).toContain("Herman Melville")
  })

  test("returns error status for bad endpoints", async () => {
    const result = await injectAndProxy(
      "test-token",
      "GET",
      "https://httpbin.org/status/404",
    )

    expect(result.status).toBe(404)
  })
})
