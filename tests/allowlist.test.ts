/**
 * Tests for allowlist path pattern matching.
 *
 * The allowlist system is the core security gate — these tests
 * verify that domain, method, and path patterns work correctly.
 */
import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import { checkAllowlist } from "../src/proxy/allowlist.ts"
import { db } from "../src/db/index.ts"
import { credentials, allowlistRules } from "../src/db/schema.ts"
import { cleanTestData } from "./helpers.ts"

beforeEach(async () => {
  await cleanTestData()
})

afterAll(async () => {
  await cleanTestData()
})

async function createCredWithRules(
  refName: string,
  rules: Array<{ domain: string; method?: string; pathPattern?: string }>,
) {
  const [cred] = await db
    .insert(credentials)
    .values({
      refName,
      tier: "auto_allow",
      description: `Test credential: ${refName}`,
      infisicalPath: "/",
    })
    .returning()

  for (const rule of rules) {
    await db.insert(allowlistRules).values({
      credentialId: cred!.id,
      domain: rule.domain,
      method: rule.method ?? "*",
      pathPattern: rule.pathPattern ?? "/**",
    })
  }

  return cred!
}

describe("Allowlist — Domain Matching", () => {
  test("allows matching domain", async () => {
    await createCredWithRules("github", [{ domain: "api.github.com" }])
    const result = await checkAllowlist("github", "GET", "https://api.github.com/repos")
    expect(result.allowed).toBe(true)
  })

  test("denies non-matching domain", async () => {
    await createCredWithRules("github", [{ domain: "api.github.com" }])
    const result = await checkAllowlist("github", "GET", "https://evil.com/repos")
    expect(result.allowed).toBe(false)
  })

  test("domain matching is exact (no subdomain wildcards)", async () => {
    await createCredWithRules("specific", [{ domain: "api.example.com" }])

    const sub = await checkAllowlist("specific", "GET", "https://sub.api.example.com/test")
    expect(sub.allowed).toBe(false)

    const parent = await checkAllowlist("specific", "GET", "https://example.com/test")
    expect(parent.allowed).toBe(false)
  })
})

describe("Allowlist — Method Matching", () => {
  test("wildcard method (*) allows any method", async () => {
    await createCredWithRules("any-method", [
      { domain: "api.example.com", method: "*" },
    ])

    const get = await checkAllowlist("any-method", "GET", "https://api.example.com/test")
    expect(get.allowed).toBe(true)

    const post = await checkAllowlist("any-method", "POST", "https://api.example.com/test")
    expect(post.allowed).toBe(true)

    const del = await checkAllowlist("any-method", "DELETE", "https://api.example.com/test")
    expect(del.allowed).toBe(true)
  })

  test("specific method only allows that method", async () => {
    await createCredWithRules("get-only", [
      { domain: "api.example.com", method: "GET" },
    ])

    const get = await checkAllowlist("get-only", "GET", "https://api.example.com/test")
    expect(get.allowed).toBe(true)

    const post = await checkAllowlist("get-only", "POST", "https://api.example.com/test")
    expect(post.allowed).toBe(false)
  })

  test("method matching is case-insensitive", async () => {
    await createCredWithRules("case-test", [
      { domain: "api.example.com", method: "GET" },
    ])

    const lower = await checkAllowlist("case-test", "get", "https://api.example.com/test")
    expect(lower.allowed).toBe(true)
  })
})

describe("Allowlist — Path Pattern Matching", () => {
  test("/** matches any path", async () => {
    await createCredWithRules("any-path", [
      { domain: "api.example.com", pathPattern: "/**" },
    ])

    const root = await checkAllowlist("any-path", "GET", "https://api.example.com/")
    expect(root.allowed).toBe(true)

    const deep = await checkAllowlist("any-path", "GET", "https://api.example.com/a/b/c/d")
    expect(deep.allowed).toBe(true)
  })

  test("/repos/** matches paths starting with /repos/", async () => {
    await createCredWithRules("repos-only", [
      { domain: "api.github.com", pathPattern: "/repos/**" },
    ])

    const match = await checkAllowlist("repos-only", "GET", "https://api.github.com/repos/dizyx/laurin")
    expect(match.allowed).toBe(true)

    const noMatch = await checkAllowlist("repos-only", "GET", "https://api.github.com/users/dizyx")
    expect(noMatch.allowed).toBe(false)
  })

  test("/users/* matches single path segment", async () => {
    await createCredWithRules("single-seg", [
      { domain: "api.github.com", pathPattern: "/users/*" },
    ])

    const match = await checkAllowlist("single-seg", "GET", "https://api.github.com/users/dizyx")
    expect(match.allowed).toBe(true)

    const deep = await checkAllowlist("single-seg", "GET", "https://api.github.com/users/dizyx/repos")
    expect(deep.allowed).toBe(false)
  })

  test("exact path matches only that path", async () => {
    await createCredWithRules("exact-path", [
      { domain: "api.example.com", pathPattern: "/v1/health" },
    ])

    const match = await checkAllowlist("exact-path", "GET", "https://api.example.com/v1/health")
    expect(match.allowed).toBe(true)

    const noMatch = await checkAllowlist("exact-path", "GET", "https://api.example.com/v1/health/deep")
    expect(noMatch.allowed).toBe(false)
  })
})

describe("Allowlist — Multiple Rules", () => {
  test("allows if ANY rule matches", async () => {
    await createCredWithRules("multi-rule", [
      { domain: "api.github.com", method: "GET", pathPattern: "/repos/**" },
      { domain: "api.github.com", method: "POST", pathPattern: "/repos/*/issues" },
    ])

    const getRepos = await checkAllowlist("multi-rule", "GET", "https://api.github.com/repos/dizyx/laurin")
    expect(getRepos.allowed).toBe(true)

    const postIssue = await checkAllowlist("multi-rule", "POST", "https://api.github.com/repos/dizyx/issues")
    expect(postIssue.allowed).toBe(true)

    const deleteRepo = await checkAllowlist("multi-rule", "DELETE", "https://api.github.com/repos/dizyx/laurin")
    expect(deleteRepo.allowed).toBe(false)
  })
})

describe("Allowlist — Edge Cases", () => {
  test("returns tier and credentialId even on deny", async () => {
    await createCredWithRules("has-info", [
      { domain: "api.allowed.com", method: "GET" },
    ])

    const result = await checkAllowlist("has-info", "GET", "https://api.denied.com/test")
    expect(result.allowed).toBe(false)
    expect(result.tier).toBe("auto_allow")
    expect(result.credentialId).not.toBeNull()
  })

  test("handles invalid URL gracefully", async () => {
    await createCredWithRules("url-test", [{ domain: "api.example.com" }])
    const result = await checkAllowlist("url-test", "GET", "not-a-valid-url")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Invalid URL")
  })
})
