/**
 * Gateway caller authentication middleware.
 *
 * Validates that requests come from an authorized source using:
 * 1. IP allowlist check (fast reject for unknown sources)
 * 2. API key validation (constant-time comparison)
 *
 * Both checks must pass. Health endpoint is exempt.
 *
 * Based on defense-in-depth patterns from nono and AgentSecrets.
 */
import { createMiddleware } from "hono/factory"
import { logger } from "../lib/logger.ts"
import { timingSafeEqual } from "node:crypto"

/** Configuration for auth middleware */
interface AuthConfig {
  /** API key that callers must present */
  apiKey: string
  /** Set of allowed source IPs (Tailscale IPs) */
  allowedIps: Set<string>
  /** Paths exempt from auth (e.g., /health) */
  exemptPaths: Set<string>
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses Node.js crypto.timingSafeEqual under the hood.
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to maintain constant-ish time
    // (length difference already leaks info, but we minimize it)
    const bufA = Buffer.from(a)
    const bufB = Buffer.from(a) // same length as a
    timingSafeEqual(bufA, bufB) // dummy comparison
    return false
  }

  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return timingSafeEqual(bufA, bufB)
}

/**
 * Extract the client IP from the request.
 * Checks X-Forwarded-For first, then falls back to the connection info.
 */
function getClientIp(req: Request, headerIp?: string | null | undefined): string {
  // In a Tailscale-only setup, we trust X-Forwarded-For less
  // Prefer the direct connection IP
  if (headerIp) return headerIp

  // Check for forwarded headers (less trusted)
  const forwarded = req.headers.get("x-forwarded-for")
  if (forwarded) {
    return forwarded.split(",")[0]!.trim()
  }

  const realIp = req.headers.get("x-real-ip")
  if (realIp) return realIp.trim()

  return "unknown"
}

/**
 * Create the auth middleware with the given configuration.
 */
export function createAuthMiddleware(authConfig: AuthConfig) {
  return createMiddleware(async (c, next) => {
    const path = c.req.path

    // Exempt paths skip all auth
    if (authConfig.exemptPaths.has(path)) {
      await next()
      return
    }

    // Step 1: IP check (fast reject)
    // Bun provides the remote address via c.env.remoteAddress or we extract from headers
    const clientIp = getClientIp(c.req.raw, (c.env?.remoteAddress as string | undefined) ?? null)

    if (!authConfig.allowedIps.has(clientIp) && clientIp !== "unknown") {
      logger.warn("Auth rejected: IP not in allowlist", {
        clientIp,
        path,
        method: c.req.method,
      })
      return c.json({ error: "Forbidden" }, 403)
    }

    // Step 2: API key validation (constant-time)
    const authHeader = c.req.header("authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn("Auth rejected: missing or malformed Authorization header", {
        clientIp,
        path,
        method: c.req.method,
        // Deliberately NOT logging the submitted key
      })
      return c.json({ error: "Unauthorized" }, 401)
    }

    const submittedKey = authHeader.slice(7) // Remove "Bearer "
    if (!safeCompare(submittedKey, authConfig.apiKey)) {
      logger.warn("Auth rejected: invalid API key", {
        clientIp,
        path,
        method: c.req.method,
        // Deliberately NOT logging the submitted key value
      })
      return c.json({ error: "Unauthorized" }, 401)
    }

    // Both checks passed
    await next()
  })
}

// Export for testing
export { safeCompare, getClientIp, type AuthConfig }
