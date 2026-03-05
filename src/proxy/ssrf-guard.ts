/**
 * SSRF protection and DNS pinning.
 *
 * Blocks proxy requests targeting internal networks, cloud metadata endpoints,
 * and loopback addresses. Resolves DNS once to prevent TOCTOU rebinding attacks.
 *
 * Based on industry patterns from nono (Phantom Token) and AgentSecrets.
 */
import { logger } from "../lib/logger.ts"
import dns from "node:dns/promises"

/** CIDR ranges that should NEVER be proxy targets */
const DENIED_CIDRS = [
  // Cloud metadata endpoints
  { network: 0xa9fea9fe, mask: 0xffffffff, label: "cloud-metadata (169.254.169.254)" },
  // RFC1918 private ranges
  { network: 0x0a000000, mask: 0xff000000, label: "RFC1918 10.0.0.0/8" },
  { network: 0xac100000, mask: 0xfff00000, label: "RFC1918 172.16.0.0/12" },
  { network: 0xc0a80000, mask: 0xffff0000, label: "RFC1918 192.168.0.0/16" },
  // Loopback
  { network: 0x7f000000, mask: 0xff000000, label: "loopback 127.0.0.0/8" },
  // Link-local
  { network: 0xa9fe0000, mask: 0xffff0000, label: "link-local 169.254.0.0/16" },
]

/** Tailscale CGNAT range — blocked by default, configurable override */
const TAILSCALE_CIDR = { network: 0x64400000, mask: 0xffc00000, label: "Tailscale 100.64.0.0/10" }

/** Convert dotted IP string to 32-bit integer */
function ipToInt(ip: string): number | null {
  const parts = ip.split(".")
  if (parts.length !== 4) return null

  let result = 0
  for (const part of parts) {
    const num = parseInt(part, 10)
    if (isNaN(num) || num < 0 || num > 255) return null
    result = (result << 8) | num
  }
  return result >>> 0 // unsigned
}

/** Check if an IP matches a CIDR range */
function ipMatchesCidr(ipInt: number, network: number, mask: number): boolean {
  return (ipInt & mask) === (network & mask)
}

interface SsrfCheckResult {
  allowed: boolean
  resolvedIp: string | null
  reason: string
}

/**
 * Check if a URL target is safe to proxy to.
 *
 * 1. Parse the hostname from the URL
 * 2. Resolve DNS to get the actual IP (prevents DNS rebinding)
 * 3. Check the resolved IP against the deny list
 *
 * @param url The target URL to validate
 * @param allowTailscale Whether to allow Tailscale IPs (default: false)
 */
export async function checkSsrf(url: string, allowTailscale = false): Promise<SsrfCheckResult> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { allowed: false, resolvedIp: null, reason: `Invalid URL: ${url}` }
  }

  const hostname = parsed.hostname

  // If the hostname is already an IP, check it directly
  const directIp = ipToInt(hostname)
  if (directIp !== null) {
    return checkIpAgainstDenyList(hostname, directIp, allowTailscale)
  }

  // Resolve DNS to get the actual IP — this prevents DNS rebinding
  // We resolve ONCE and use the result for both the check and the connection
  let resolvedIps: string[]
  try {
    resolvedIps = await dns.resolve4(hostname)
  } catch (err) {
    logger.warn("DNS resolution failed for SSRF check", {
      hostname,
      error: err instanceof Error ? err.message : String(err),
    })
    // If DNS fails, block — fail closed
    return { allowed: false, resolvedIp: null, reason: `DNS resolution failed for ${hostname}` }
  }

  if (resolvedIps.length === 0) {
    return { allowed: false, resolvedIp: null, reason: `No DNS records for ${hostname}` }
  }

  // Check ALL resolved IPs — if any is blocked, deny the request
  for (const ip of resolvedIps) {
    const ipInt = ipToInt(ip)
    if (ipInt === null) continue

    const check = checkIpAgainstDenyList(ip, ipInt, allowTailscale)
    if (!check.allowed) {
      logger.warn("SSRF blocked", {
        hostname,
        resolvedIp: ip,
        reason: check.reason,
      })
      return check
    }
  }

  return { allowed: true, resolvedIp: resolvedIps[0] ?? null, reason: "Allowed" }
}

/** Check a single IP against the deny list */
function checkIpAgainstDenyList(
  ip: string,
  ipInt: number,
  allowTailscale: boolean,
): SsrfCheckResult {
  // Check denied CIDRs
  for (const cidr of DENIED_CIDRS) {
    if (ipMatchesCidr(ipInt, cidr.network, cidr.mask)) {
      return {
        allowed: false,
        resolvedIp: ip,
        reason: `Blocked: ${cidr.label}`,
      }
    }
  }

  // Check Tailscale range (blocked by default)
  if (!allowTailscale && ipMatchesCidr(ipInt, TAILSCALE_CIDR.network, TAILSCALE_CIDR.mask)) {
    return {
      allowed: false,
      resolvedIp: ip,
      reason: `Blocked: ${TAILSCALE_CIDR.label} (set allowTailscale=true to override)`,
    }
  }

  // IPv6 loopback check — if the URL uses [::1]
  if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") {
    return {
      allowed: false,
      resolvedIp: ip,
      reason: "Blocked: IPv6 loopback",
    }
  }

  return { allowed: true, resolvedIp: ip, reason: "Allowed" }
}

// Export for testing
export { ipToInt, ipMatchesCidr, DENIED_CIDRS, TAILSCALE_CIDR }
