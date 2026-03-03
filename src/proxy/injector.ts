/**
 * Credential injection and response stripping.
 *
 * Injects the real secret into the outbound request headers,
 * makes the API call, and strips any credential-related headers
 * from the response before returning to the agent.
 */
import { logger } from "../lib/logger.ts"

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

  // Parse response body
  let body: unknown
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    body = await response.json()
  } else {
    body = await response.text()
  }

  logger.info("Outbound proxy response", {
    status: response.status,
    latencyMs,
    url,
  })

  return {
    status: response.status,
    headers: cleanHeaders,
    body,
    latencyMs,
  }
}
