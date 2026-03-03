/**
 * Allowlist validation for proxy requests.
 *
 * Each credential has a set of allowlist rules defining which
 * domain + method + path combinations are permitted. This module
 * checks incoming requests against those rules.
 */
import { db } from "../db/index.ts"
import { allowlistRules, credentials } from "../db/schema.ts"
import { eq } from "drizzle-orm"
import { logger } from "../lib/logger.ts"
import type { CredentialTier } from "../lib/types.ts"

interface AllowlistCheckResult {
  allowed: boolean
  credentialId: string | null
  tier: CredentialTier | null
  infisicalPath: string | null
  reason: string
}

/** Match a URL path against a glob-like pattern */
function matchPath(path: string, pattern: string): boolean {
  // "/**" matches everything
  if (pattern === "/**") return true

  // Convert glob pattern to regex
  const regexStr = pattern
    .replace(/\*\*/g, "DOUBLE_STAR")
    .replace(/\*/g, "[^/]*")
    .replace(/DOUBLE_STAR/g, ".*")

  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(path)
}

/** Check if a proxy request is allowed by the credential's allowlist rules */
export async function checkAllowlist(
  credentialRef: string,
  method: string,
  url: string,
): Promise<AllowlistCheckResult> {
  // Look up the credential
  const [credential] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.refName, credentialRef))
    .limit(1)

  if (!credential) {
    return {
      allowed: false,
      credentialId: null,
      tier: null,
      infisicalPath: null,
      reason: `Unknown credential: ${credentialRef}`,
    }
  }

  // Catalog-only credentials can't be proxied
  if (credential.catalogOnly) {
    return {
      allowed: false,
      credentialId: credential.id,
      tier: credential.tier as CredentialTier,
      infisicalPath: credential.infisicalPath,
      reason: `Credential "${credentialRef}" is catalog-only (not proxied)`,
    }
  }

  // Parse the target URL
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return {
      allowed: false,
      credentialId: credential.id,
      tier: credential.tier as CredentialTier,
      infisicalPath: credential.infisicalPath,
      reason: `Invalid URL: ${url}`,
    }
  }

  // Get the allowlist rules for this credential
  const rules = await db
    .select()
    .from(allowlistRules)
    .where(eq(allowlistRules.credentialId, credential.id))

  if (rules.length === 0) {
    return {
      allowed: false,
      credentialId: credential.id,
      tier: credential.tier as CredentialTier,
      infisicalPath: credential.infisicalPath,
      reason: `No allowlist rules defined for "${credentialRef}"`,
    }
  }

  // Check each rule
  const upperMethod = method.toUpperCase()
  for (const rule of rules) {
    const domainMatch = parsedUrl.hostname === rule.domain
    const methodMatch = rule.method === "*" || rule.method.toUpperCase() === upperMethod
    const pathMatch = matchPath(parsedUrl.pathname, rule.pathPattern)

    if (domainMatch && methodMatch && pathMatch) {
      logger.debug("Allowlist match", {
        credentialRef,
        method: upperMethod,
        domain: parsedUrl.hostname,
        path: parsedUrl.pathname,
        ruleId: rule.id,
      })

      return {
        allowed: true,
        credentialId: credential.id,
        tier: credential.tier as CredentialTier,
        infisicalPath: credential.infisicalPath,
        reason: "Allowed by rule",
      }
    }
  }

  return {
    allowed: false,
    credentialId: credential.id,
    tier: credential.tier as CredentialTier,
    infisicalPath: credential.infisicalPath,
    reason: `No matching allowlist rule for ${upperMethod} ${parsedUrl.hostname}${parsedUrl.pathname}`,
  }
}
