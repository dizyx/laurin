/**
 * Credential injection, response stripping, and body redaction.
 *
 * Injects the real secret into the outbound request headers,
 * makes the API call, strips any credential-related headers
 * from the response, and scans the response body for any leaked
 * secret values before returning to the agent.
 *
 * Security features:
 * - SSRF protection: blocks requests to internal/metadata endpoints
 * - Response header stripping: removes auth-related headers
 * - Response body redaction: replaces leaked token values with [REDACTED_BY_LAURIN]
 */
import { logger } from "../lib/logger.ts"
import { checkSsrf } from "./ssrf-guard.ts"

/** Headers that must NEVER be returned to the agent */
const STRIPPED_RESPONSE_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "x-auth-token",
  "www-authenticate",
  "proxy-authorization",
  "set-cookie",
])

/** Headers that should not be forwarded in the outbound request */
const STRIPPED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "transfer-encoding",
])

interface InjectionResult {
  status: number
  headers: Record<string, string>
  body: unknown
  latencyMs: number
}

/**
 * Inject credential into the request, make the outbound call,
 * and return a clean response.
 *
 * The secret value is injected as an Authorization Bearer token by default.
 * The agent never sees this header — it's added here and stripped from the response.
 */
export async function injectAndProxy(
  secretValue: string,
  method: string,
  url: string,
  agentHeaders?: Record<string, string>,
  agentBody?: unknown,
): Promise<InjectionResult> {
  const startTime = performance.now()

  // SSRF check — block requests to internal networks, metadata endpoints, etc.
  const ssrfCheck = await checkSsrf(url)
  if (!ssrfCheck.allowed) {
    logger.warn("SSRF blocked in proxy", {
      url,
      reason: ssrfCheck.reason,
      resolvedIp: ssrfCheck.resolvedIp,
    })
    throw new SsrfBlockedError(ssrfCheck.reason)
  }

  // Build outbound headers — inject the credential
  const outboundHeaders: Record<string, string> = {
    Authorization: `Bearer ${secretValue}`,
  }

  // Forward safe headers from the agent's request
  if (agentHeaders) {
    for (const [key, value] of Object.entries(agentHeaders)) {
      const lowerKey = key.toLowerCase()
      // Never forward auth headers from the agent (they don't have the real token)
      // Never forward connection-level headers
      if (!lowerKey.startsWith("authorization") && !STRIPPED_REQUEST_HEADERS.has(lowerKey)) {
        outboundHeaders[key] = value
      }
    }
  }

  // If no content-type set and we have a body, default to JSON
  if (agentBody && !outboundHeaders["Content-Type"] && !outboundHeaders["content-type"]) {
    outboundHeaders["Content-Type"] = "application/json"
  }

  // Make the outbound API call
  const fetchOptions: RequestInit = {
    method: method.toUpperCase(),
    headers: outboundHeaders,
  }

  if (agentBody && method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD") {
    fetchOptions.body = typeof agentBody === "string" ? agentBody : JSON.stringify(agentBody)
  }

  logger.info("Outbound proxy request", {
    method: method.toUpperCase(),
    url,
    // Deliberately NOT logging the Authorization header
  })

  const response = await fetch(url, fetchOptions)
  const latencyMs = Math.round(performance.now() - startTime)

  // Strip credential-related headers from the response
  const cleanHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      cleanHeaders[key] = value
    }
  })

  // Parse response body and redact any leaked secret values
  let body: unknown
  let redacted = false
  const contentType = response.headers.get("content-type") ?? ""

  if (contentType.includes("application/json")) {
    // For JSON responses, get as text first so we can scan for leaks
    const rawText = await response.text()
    const { text: cleanText, wasRedacted } = redactSecret(rawText, secretValue)
    redacted = wasRedacted
    try {
      body = JSON.parse(cleanText)
    } catch {
      // If redaction broke JSON parsing, return as text
      body = cleanText
    }
  } else {
    const rawText = await response.text()
    const { text: cleanText, wasRedacted } = redactSecret(rawText, secretValue)
    redacted = wasRedacted
    body = cleanText
  }

  if (redacted) {
    logger.warn("Response body contained leaked secret — redacted", {
      url,
      method: method.toUpperCase(),
      // Deliberately NOT logging which secret or what was redacted
    })
  }

  logger.info("Outbound proxy response", {
    status: response.status,
    latencyMs,
    url,
    redacted,
  })

  return {
    status: response.status,
    headers: cleanHeaders,
    body,
    latencyMs,
  }
}

/**
 * Scan text for the secret value and replace all occurrences.
 * Only redacts if the secret is at least 8 characters (avoid false positives).
 */
function redactSecret(text: string, secret: string): { text: string; wasRedacted: boolean } {
  if (secret.length < 8) {
    // Short secrets risk false positives — skip body redaction
    // (header stripping still protects these)
    return { text, wasRedacted: false }
  }

  if (!text.includes(secret)) {
    return { text, wasRedacted: false }
  }

  return {
    text: text.replaceAll(secret, "[REDACTED_BY_LAURIN]"),
    wasRedacted: true,
  }
}

/** Custom error for SSRF blocks — handler.ts can catch and return 403 */
export class SsrfBlockedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "SsrfBlockedError"
  }
}

// Export for testing
export { redactSecret }
