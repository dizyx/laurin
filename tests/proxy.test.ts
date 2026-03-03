/**
 * Integration tests for the core proxy endpoint.
 *
 * Tests the full lifecycle: allowlist check → secret fetch → inject → proxy → strip.
 * Uses httpbin.org as the target API for real HTTP calls.
 */
import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import { createTestApp, cleanTestData, jsonRequest } from "./helpers.ts"
import { db } from "../src/db/index.ts"
import { credentials, allowlistRules, auditLog } from "../src/db/schema.ts"
import { eq } from "drizzle-orm"

const app = createTestApp()

beforeEach(async () => {
  await cleanTestData()
})

afterAll(async () => {
  await cleanTestData()
})

describe("Proxy — Request Validation", () => {
  test("rejects missing credentialRef", async () => {
    const { status } = await jsonRequest(app, "POST", "/proxy", {
      method: "GET",
      url: "https://example.com",
    })
    expect(status).toBe(400)
  })

  test("rejects invalid HTTP method", async () => {
    const { status } = await jsonRequest(app, "POST", "/proxy", {
      credentialRef: "test",
      method: "INVALID",
      url: "https://example.com",
    })
    expect(status).toBe(400)
  })

  test("rejects invalid URL", async () => {
    const { status } = await jsonRequest(app, "POST", "/proxy", {
      credentialRef: "test",
      method: "GET",
      url: "not-a-url",
    })
    expect(status).toBe(400)
  })

  test("rejects empty body", async () => {
    const response = await app.request("/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
    // Empty object missing required fields
    expect(response.status).toBe(400)
  })
})

describe("Proxy — Allowlist Enforcement", () => {
  test("denies unknown credential ref", async () => {
    const { status, body } = await jsonRequest(app, "POST", "/proxy", {
      credentialRef: "nonexistent-cred",
      method: "GET",
      url: "https://api.github.com/repos/dizyx/laurin",
    })

    expect(status).toBe(403)
    const data = body as { error: string; reason: string }
    expect(data.reason).toContain("Unknown credential")
  })

  test("denies credential with no allowlist rules", async () => {
    // Create credential without any rules
    await db.insert(credentials).values({
      refName: "no-rules",
      tier: "auto_allow",
      description: "Has no allowlist rules",
      infisicalPath: "/",
    })

    const { status, body } = await jsonRequest(app, "POST", "/proxy", {
      credentialRef: "no-rules",
      method: "GET",
      url: "https://api.github.com/repos",
    })

    expect(status).toBe(403)
    const data = body as { reason: string }
    expect(data.reason).toContain("No allowlist rules")
  })

  test("denies request to non-matching domain", async () => {
    const [cred] = await db
      .insert(credentials)
      .values({
        refName: "github-only",
        tier: "auto_allow",
        description: "Only allowed for GitHub",
        infisicalPath: "/",
      })
      .returning()

    await db.insert(allowlistRules).values({
      credentialId: cred!.id,
      domain: "api.github.com",
      method: "GET",
      pathPattern: "/**",
    })

    const { status, body } = await jsonRequest(app, "POST", "/proxy", {
      credentialRef: "github-only",
      method: "GET",
      url: "https://evil.com/steal-token",
    })

    expect(status).toBe(403)
    const data = body as { reason: string }
    expect(data.reason).toContain("No matching allowlist rule")
  })

  test("denies request with wrong HTTP method", async () => {
    const [cred] = await db
      .insert(credentials)
      .values({
        refName: "read-only",
        tier: "auto_allow",
        description: "Read-only access",
        infisicalPath: "/",
      })
      .returning()

    await db.insert(allowlistRules).values({
      credentialId: cred!.id,
      domain: "api.github.com",
      method: "GET",
      pathPattern: "/**",
    })

    // Try a POST — should be denied
    const { status } = await jsonRequest(app, "POST", "/proxy", {
      credentialRef: "read-only",
      method: "POST",
      url: "https://api.github.com/repos/dizyx/laurin",
    })

    expect(status).toBe(403)
  })

  test("denies catalog-only credentials", async () => {
    await db.insert(credentials).values({
      refName: "catalog-cred",
      tier: "catalog_only",
      description: "Catalog only, not proxied",
      catalogOnly: true,
      infisicalPath: null,
    })

    const { status, body } = await jsonRequest(app, "POST", "/proxy", {
      credentialRef: "catalog-cred",
      method: "GET",
      url: "https://example.com",
    })

    expect(status).toBe(403)
    const data = body as { reason: string }
    expect(data.reason).toContain("catalog-only")
  })
})

describe("Proxy — Tier-Based Decisions", () => {
  test("returns 202 for always-ask tier (approval required)", async () => {
    const [cred] = await db
      .insert(credentials)
      .values({
        refName: "always-ask-cred",
        tier: "always_ask",
        description: "Requires approval every time",
        infisicalPath: "/",
      })
      .returning()

    await db.insert(allowlistRules).values({
      credentialId: cred!.id,
      domain: "api.stripe.com",
      method: "*",
      pathPattern: "/**",
    })

    const { status, body } = await jsonRequest(app, "POST", "/proxy", {
      credentialRef: "always-ask-cred",
      method: "POST",
      url: "https://api.stripe.com/v1/charges",
    })

    expect(status).toBe(202)
    const data = body as { tier: string }
    expect(data.tier).toBe("always_ask")
  })

  test("returns 202 for ask-once tier (approval required)", async () => {
    const [cred] = await db
      .insert(credentials)
      .values({
        refName: "ask-once-cred",
        tier: "ask_once",
        description: "Needs one-time approval",
        infisicalPath: "/",
      })
      .returning()

    await db.insert(allowlistRules).values({
      credentialId: cred!.id,
      domain: "api.example.com",
      method: "*",
      pathPattern: "/**",
    })

    const { status } = await jsonRequest(app, "POST", "/proxy", {
      credentialRef: "ask-once-cred",
      method: "GET",
      url: "https://api.example.com/data",
    })

    expect(status).toBe(202)
  })
})

describe("Proxy — Audit Logging", () => {
  test("logs denied requests", async () => {
    await jsonRequest(app, "POST", "/proxy", {
      credentialRef: "unknown-for-audit",
      method: "GET",
      url: "https://example.com",
    })

    const logs = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.credentialRef, "unknown-for-audit"))

    expect(logs.length).toBe(1)
    expect(logs[0]!.decision).toBe("denied")
    expect(logs[0]!.method).toBe("GET")
    expect(logs[0]!.url).toBe("https://example.com")
  })

  test("logs approval-pending requests", async () => {
    const [cred] = await db
      .insert(credentials)
      .values({
        refName: "audit-ask",
        tier: "always_ask",
        description: "For audit test",
        infisicalPath: "/",
      })
      .returning()

    await db.insert(allowlistRules).values({
      credentialId: cred!.id,
      domain: "api.example.com",
      method: "*",
      pathPattern: "/**",
    })

    await jsonRequest(
      app,
      "POST",
      "/proxy",
      {
        credentialRef: "audit-ask",
        method: "GET",
        url: "https://api.example.com/test",
      },
      { "X-Agent-Id": "agent-007" },
    )

    const logs = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.credentialRef, "audit-ask"))

    expect(logs.length).toBe(1)
    expect(logs[0]!.decision).toBe("pending_approval")
    expect(logs[0]!.agentId).toBe("agent-007")
  })

  test("captures X-Agent-Id header in audit log", async () => {
    await jsonRequest(
      app,
      "POST",
      "/proxy",
      {
        credentialRef: "some-cred",
        method: "GET",
        url: "https://example.com",
      },
      { "X-Agent-Id": "claude-session-abc" },
    )

    const logs = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.credentialRef, "some-cred"))

    expect(logs.length).toBe(1)
    expect(logs[0]!.agentId).toBe("claude-session-abc")
  })
})
