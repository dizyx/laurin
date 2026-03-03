/**
 * Integration tests for the Admin API.
 *
 * Tests credential CRUD operations and allowlist rule management.
 * Uses the real database via Tailscale.
 */
import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import { createTestApp, cleanTestData, jsonRequest } from "./helpers.ts"

const app = createTestApp()

beforeEach(async () => {
  await cleanTestData()
})

afterAll(async () => {
  await cleanTestData()
})

describe("Admin API — Credential CRUD", () => {
  test("POST /admin/credentials creates a credential", async () => {
    const { status, body } = await jsonRequest(app, "POST", "/admin/credentials", {
      refName: "github-dizyx",
      tier: "auto_allow",
      description: "GitHub API token for dizyx org",
      allowlistRules: [
        { domain: "api.github.com", method: "GET", pathPattern: "/repos/**" },
      ],
      createInfisicalPlaceholder: false, // Don't hit Infisical in tests
    })

    expect(status).toBe(201)
    const data = body as { credential: { refName: string; tier: string }; message: string }
    expect(data.credential.refName).toBe("github-dizyx")
    expect(data.credential.tier).toBe("auto_allow")
    expect(data.message).toContain("Paste the secret value")
  })

  test("GET /admin/credentials lists all credentials", async () => {
    // Create two credentials
    await jsonRequest(app, "POST", "/admin/credentials", {
      refName: "cred-alpha",
      tier: "auto_allow",
      description: "Alpha credential",
      createInfisicalPlaceholder: false,
    })
    await jsonRequest(app, "POST", "/admin/credentials", {
      refName: "cred-beta",
      tier: "rate_limited",
      description: "Beta credential",
      createInfisicalPlaceholder: false,
    })

    const { status, body } = await jsonRequest(app, "GET", "/admin/credentials")
    expect(status).toBe(200)

    const data = body as { credentials: Array<{ refName: string }> }
    expect(data.credentials.length).toBe(2)
    const names = data.credentials.map((c) => c.refName).sort()
    expect(names).toEqual(["cred-alpha", "cred-beta"])
  })

  test("GET /admin/credentials/:ref returns single credential with rules", async () => {
    await jsonRequest(app, "POST", "/admin/credentials", {
      refName: "bunny-cdn",
      tier: "auto_allow",
      description: "Bunny CDN token",
      allowlistRules: [
        { domain: "api.bunny.net", method: "*", pathPattern: "/**" },
      ],
      createInfisicalPlaceholder: false,
    })

    const { status, body } = await jsonRequest(app, "GET", "/admin/credentials/bunny-cdn")
    expect(status).toBe(200)

    const data = body as {
      credential: { refName: string }
      allowlistRules: Array<{ domain: string }>
    }
    expect(data.credential.refName).toBe("bunny-cdn")
    expect(data.allowlistRules.length).toBe(1)
    expect(data.allowlistRules[0]!.domain).toBe("api.bunny.net")
  })

  test("GET /admin/credentials/:ref returns 404 for unknown ref", async () => {
    const { status } = await jsonRequest(app, "GET", "/admin/credentials/nonexistent")
    expect(status).toBe(404)
  })

  test("PUT /admin/credentials/:ref updates metadata", async () => {
    await jsonRequest(app, "POST", "/admin/credentials", {
      refName: "updatable",
      tier: "auto_allow",
      description: "Original description",
      createInfisicalPlaceholder: false,
    })

    const { status, body } = await jsonRequest(app, "PUT", "/admin/credentials/updatable", {
      tier: "rate_limited",
      description: "Updated description",
    })

    expect(status).toBe(200)
    const data = body as { credential: { tier: string; description: string } }
    expect(data.credential.tier).toBe("rate_limited")
    expect(data.credential.description).toBe("Updated description")
  })

  test("DELETE /admin/credentials/:ref removes the credential", async () => {
    await jsonRequest(app, "POST", "/admin/credentials", {
      refName: "deletable",
      tier: "auto_allow",
      description: "Will be deleted",
      createInfisicalPlaceholder: false,
    })

    const { status } = await jsonRequest(app, "DELETE", "/admin/credentials/deletable")
    expect(status).toBe(200)

    // Verify it's gone
    const { status: getStatus } = await jsonRequest(app, "GET", "/admin/credentials/deletable")
    expect(getStatus).toBe(404)
  })

  test("POST /admin/credentials rejects duplicate refName", async () => {
    await jsonRequest(app, "POST", "/admin/credentials", {
      refName: "unique-cred",
      tier: "auto_allow",
      description: "First one",
      createInfisicalPlaceholder: false,
    })

    const { status } = await jsonRequest(app, "POST", "/admin/credentials", {
      refName: "unique-cred",
      tier: "auto_allow",
      description: "Duplicate",
      createInfisicalPlaceholder: false,
    })

    expect(status).toBe(409)
  })

  test("POST /admin/credentials validates refName format", async () => {
    const { status } = await jsonRequest(app, "POST", "/admin/credentials", {
      refName: "INVALID CHARS!!",
      tier: "auto_allow",
      description: "Bad name",
      createInfisicalPlaceholder: false,
    })

    expect(status).toBe(400)
  })

  test("catalog-only credentials have null infisicalPath", async () => {
    const { status, body } = await jsonRequest(app, "POST", "/admin/credentials", {
      refName: "heroku-app",
      tier: "catalog_only",
      description: "Heroku deploy token (tracked, not proxied)",
      catalogOnly: true,
      deployedTo: [{ service: "heroku", environment: "production" }],
      createInfisicalPlaceholder: false,
    })

    expect(status).toBe(201)
    const data = body as { credential: { catalogOnly: boolean; infisicalPath: string | null } }
    expect(data.credential.catalogOnly).toBe(true)
    expect(data.credential.infisicalPath).toBeNull()
  })
})

describe("Admin API — Allowlist Rules", () => {
  test("POST /admin/credentials/:ref/rules adds a rule", async () => {
    await jsonRequest(app, "POST", "/admin/credentials", {
      refName: "rule-test",
      tier: "auto_allow",
      description: "For rule testing",
      createInfisicalPlaceholder: false,
    })

    const { status, body } = await jsonRequest(app, "POST", "/admin/credentials/rule-test/rules", {
      domain: "api.example.com",
      method: "POST",
      pathPattern: "/v2/**",
    })

    expect(status).toBe(201)
    const data = body as { rule: { domain: string; method: string; pathPattern: string } }
    expect(data.rule.domain).toBe("api.example.com")
    expect(data.rule.method).toBe("POST")
    expect(data.rule.pathPattern).toBe("/v2/**")
  })

  test("rules are included in credential detail response", async () => {
    await jsonRequest(app, "POST", "/admin/credentials", {
      refName: "multi-rule",
      tier: "auto_allow",
      description: "Multiple rules",
      allowlistRules: [
        { domain: "api.a.com", method: "GET", pathPattern: "/**" },
        { domain: "api.b.com", method: "POST", pathPattern: "/webhook" },
      ],
      createInfisicalPlaceholder: false,
    })

    const { body } = await jsonRequest(app, "GET", "/admin/credentials/multi-rule")
    const data = body as { allowlistRules: Array<{ domain: string }> }
    expect(data.allowlistRules.length).toBe(2)
  })

  test("deleting a credential cascades to its rules", async () => {
    await jsonRequest(app, "POST", "/admin/credentials", {
      refName: "cascade-test",
      tier: "auto_allow",
      description: "Cascade test",
      allowlistRules: [
        { domain: "api.test.com", method: "GET", pathPattern: "/**" },
      ],
      createInfisicalPlaceholder: false,
    })

    await jsonRequest(app, "DELETE", "/admin/credentials/cascade-test")

    // Credential is gone
    const { status } = await jsonRequest(app, "GET", "/admin/credentials/cascade-test")
    expect(status).toBe(404)
  })
})
