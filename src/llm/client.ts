/**
 * DGX Spark local LLM client.
 *
 * Connects to the local LLM via Tailscale for edge case decisions:
 * allowlist management, anomaly detection, new pattern evaluation.
 *
 * The LLM NEVER sees secret values — only ref names, domains,
 * patterns, and audit summaries.
 *
 * TODO: Implement once local LLM endpoint is ready (task #965)
 */
import { logger } from "../lib/logger.ts"

/** Ask the local LLM to evaluate a new endpoint pattern */
export async function evaluatePattern(
  _credentialRef: string,
  _method: string,
  _url: string,
  _context: Record<string, unknown>,
): Promise<{ allowed: boolean; confidence: number; reason: string }> {
  logger.warn("Local LLM integration not yet implemented")
  return { allowed: false, confidence: 0, reason: "LLM integration not yet implemented" }
}
