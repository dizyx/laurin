/**
 * Shared types for Laurin.
 */

/** Credential tier determines how proxy requests are handled */
export type CredentialTier =
  | "auto_allow"
  | "rate_limited"
  | "ask_once"
  | "always_ask"
  | "catalog_only"

/** Decision outcome for a proxy request */
export type ProxyDecision =
  | "allowed"
  | "denied"
  | "rate_limited"
  | "pending_approval"
  | "approved"
  | "rejected"

/** Proxy request from an agent */
export interface ProxyRequest {
  credentialRef: string
  method: string
  url: string
  headers?: Record<string, string>
  body?: unknown
}

/** Proxy response back to the agent (credentials stripped) */
export interface ProxyResponse {
  status: number
  headers: Record<string, string>
  body: unknown
}

/** Rate limit configuration for a credential */
export interface RateLimitConfig {
  max: number
  windowSeconds: number
}

/** Deployment location for catalog-only credentials */
export interface DeploymentLocation {
  service: string
  environment: string
  notes?: string
}

/** Credential metadata (never includes the actual secret value) */
export interface CredentialMetadata {
  refName: string
  tier: CredentialTier
  description: string
  infisicalPath: string | null
  catalogOnly: boolean
  deployedTo: DeploymentLocation[]
  rateLimit: RateLimitConfig | null
}
