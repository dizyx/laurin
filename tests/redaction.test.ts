/**
 * Tests for response body redaction.
 *
 * Verifies that leaked secret values in response bodies are replaced
 * with [REDACTED_BY_LAURIN] before returning to the agent.
 */
import { describe, test, expect } from "bun:test"
import { redactSecret } from "../src/proxy/injector.ts"

describe("redactSecret", () => {
  test("redacts secret found in plain text", () => {
    const text = "Your token is ghp_abc123def456ghi789"
    const result = redactSecret(text, "ghp_abc123def456ghi789")
    expect(result.wasRedacted).toBe(true)
    expect(result.text).toBe("Your token is [REDACTED_BY_LAURIN]")
    expect(result.text).not.toContain("ghp_abc123def456ghi789")
  })

  test("redacts secret found in JSON body", () => {
    const json = JSON.stringify({
      error: "Invalid token: ghp_abc123def456ghi789",
      hint: "Please use ghp_abc123def456ghi789 in Authorization header",
    })
    const result = redactSecret(json, "ghp_abc123def456ghi789")
    expect(result.wasRedacted).toBe(true)
    // Should redact ALL occurrences
    expect(result.text).not.toContain("ghp_abc123def456ghi789")
    const parsed = JSON.parse(result.text)
    expect(parsed.error).toContain("[REDACTED_BY_LAURIN]")
    expect(parsed.hint).toContain("[REDACTED_BY_LAURIN]")
  })

  test("does not redact when secret is not present", () => {
    const text = "Everything is fine, no secrets here"
    const result = redactSecret(text, "my-secret-token-value")
    expect(result.wasRedacted).toBe(false)
    expect(result.text).toBe(text)
  })

  test("does not redact short secrets (< 8 chars) to avoid false positives", () => {
    const text = "The word 'test' appears in this text"
    const result = redactSecret(text, "test")
    expect(result.wasRedacted).toBe(false)
    expect(result.text).toBe(text)
  })

  test("redacts secrets that are exactly 8 characters", () => {
    const text = "Token: 12345678 was leaked"
    const result = redactSecret(text, "12345678")
    expect(result.wasRedacted).toBe(true)
    expect(result.text).toBe("Token: [REDACTED_BY_LAURIN] was leaked")
  })

  test("handles empty text", () => {
    const result = redactSecret("", "my-secret-token-value")
    expect(result.wasRedacted).toBe(false)
    expect(result.text).toBe("")
  })

  test("handles secret appearing multiple times", () => {
    const secret = "sk_live_abcdefghijk"
    const text = `First: ${secret}, Second: ${secret}, Third: ${secret}`
    const result = redactSecret(text, secret)
    expect(result.wasRedacted).toBe(true)
    // Count occurrences of redaction marker
    const matches = result.text.match(/\[REDACTED_BY_LAURIN\]/g)
    expect(matches).toHaveLength(3)
    expect(result.text).not.toContain(secret)
  })

  test("handles secret in Authorization header format in body", () => {
    const secret = "ghp_1234567890abcdef"
    const text = JSON.stringify({
      debug: { authorization: `Bearer ${secret}` },
    })
    const result = redactSecret(text, secret)
    expect(result.wasRedacted).toBe(true)
    expect(result.text).not.toContain(secret)
  })
})
