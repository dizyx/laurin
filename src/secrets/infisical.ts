/**
 * Infisical Cloud REST API client.
 *
 * Authenticates via Universal Auth (client ID + client secret),
 * fetches secrets by key name from the Laurin project.
 *
 * The access token is cached and refreshed when it expires.
 * Individual secrets are cached in the SecretCache (60s TTL).
 */
import { config } from "../lib/config.ts"
import { logger } from "../lib/logger.ts"
import { createSecretCache, type SecretCache } from "./cache.ts"

interface AuthToken {
  accessToken: string
  expiresAt: number // Unix timestamp in ms
}

let authToken: AuthToken | null = null
const secretCache: SecretCache = createSecretCache(config.secretCacheTtlMs)

/** Authenticate with Infisical using Universal Auth */
async function authenticate(): Promise<string> {
  // Return cached token if still valid (with 5 min buffer)
  if (authToken && authToken.expiresAt > Date.now() + 5 * 60 * 1000) {
    return authToken.accessToken
  }

  const response = await fetch(`${config.infisical.apiUrl}/api/v1/auth/universal-auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: config.infisical.clientId,
      clientSecret: config.infisical.clientSecret,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Infisical auth failed (${response.status}): ${body}`)
  }

  const data = (await response.json()) as {
    accessToken: string
    expiresIn: number
  }

  authToken = {
    accessToken: data.accessToken,
    expiresAt: Date.now() + data.expiresIn * 1000,
  }

  logger.info("Infisical authentication successful", {
    expiresIn: data.expiresIn,
  })

  return authToken.accessToken
}

/** Fetch a single secret from Infisical by key name */
async function fetchFromInfisical(secretName: string, secretPath = "/"): Promise<string> {
  const token = await authenticate()

  const params = new URLSearchParams({
    workspaceId: config.infisical.projectId,
    environment: config.infisical.environment,
    secretPath,
  })

  const response = await fetch(
    `${config.infisical.apiUrl}/api/v3/secrets/raw/${encodeURIComponent(secretName)}?${params}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Infisical fetch failed for "${secretName}" (${response.status}): ${body}`)
  }

  const data = (await response.json()) as {
    secret: { secretValue: string }
  }

  return data.secret.secretValue
}

/**
 * Get a secret value by reference name.
 *
 * Checks in-memory cache first (60s TTL), then fetches from Infisical.
 * This is the main entry point for the proxy to get credential values.
 */
export async function getSecret(refName: string, secretPath = "/"): Promise<string> {
  // Check cache first
  const cached = secretCache.get(refName)
  if (cached !== null) {
    logger.debug("Secret cache hit", { refName })
    return cached
  }

  // Fetch from Infisical
  logger.debug("Secret cache miss, fetching from Infisical", { refName })
  const value = await fetchFromInfisical(refName, secretPath)
  secretCache.set(refName, value)
  return value
}

/** Create an empty secret placeholder in Infisical */
export async function createSecretPlaceholder(
  secretName: string,
  secretPath = "/",
  comment = "",
): Promise<void> {
  const token = await authenticate()

  const response = await fetch(`${config.infisical.apiUrl}/api/v3/secrets/raw/${encodeURIComponent(secretName)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workspaceId: config.infisical.projectId,
      environment: config.infisical.environment,
      secretPath,
      secretValue: "",
      secretComment: comment || `Placeholder created by Laurin Admin API. Paste the real value in Infisical UI.`,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Infisical create failed for "${secretName}" (${response.status}): ${body}`)
  }

  logger.info("Infisical placeholder created", { secretName, secretPath })
}

/** List all secrets in the project (keys only, no values exposed) */
export async function listSecretKeys(secretPath = "/"): Promise<string[]> {
  const token = await authenticate()

  const params = new URLSearchParams({
    workspaceId: config.infisical.projectId,
    environment: config.infisical.environment,
    secretPath,
  })

  const response = await fetch(`${config.infisical.apiUrl}/api/v3/secrets/raw?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Infisical list failed (${response.status}): ${body}`)
  }

  const data = (await response.json()) as {
    secrets: Array<{ secretKey: string }>
  }

  return data.secrets.map((s) => s.secretKey)
}

/** Invalidate a cached secret (e.g., after rotation) */
export function invalidateSecret(refName: string): void {
  secretCache.invalidate(refName)
}

/** Clear the entire secret cache */
export function clearSecretCache(): void {
  secretCache.clear()
}
