/**
 * SOPS/age fallback secret reader.
 *
 * Reads secrets from a SOPS-encrypted file as a backup
 * when Infisical Cloud is unreachable. This is the "break glass" layer.
 *
 * TODO: Implement once SOPS/age is configured on the VPS (task #962)
 */
import { logger } from "../lib/logger.ts"

/** Placeholder: will read from SOPS-encrypted file */
export async function getSecretFromSops(_refName: string): Promise<string | null> {
  logger.warn("SOPS fallback not yet configured")
  return null
}
