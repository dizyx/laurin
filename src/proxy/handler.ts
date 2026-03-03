/**
 * Core proxy endpoint handler.
 *
 * POST /proxy
 * Agent sends: { credentialRef, method, url, headers?, body? }
 * Laurin validates → fetches secret → injects → proxies → strips → returns
 */
import { Hono } from "hono"
import { z } from "zod"
import { checkAllowlist } from "./allowlist.ts"
import { injectAndProxy } from "./injector.ts"
import { getSecret } from "../secrets/infisical.ts"
import { db } from "../db/index.ts"
import { auditLog } from "../db/schema.ts"
import { logger } from "../lib/logger.ts"

// Zod schema for proxy request validation
const proxyRequestSchema = z.object({
  credentialRef: z.string().min(1).max(128),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
})

export const proxyRouter = new Hono()

proxyRouter.post("/proxy", async (c) => {
  const startTime = performance.now()

  // Parse and validate the request
  const rawBody = await c.req.json()
  const parseResult = proxyRequestSchema.safeParse(rawBody)

  if (!parseResult.success) {
    return c.json(
      { error: "Invalid request", details: parseResult.error.flatten() },
      400,
    )
  }

  const { credentialRef, method, url, headers, body } = parseResult.data
  const agentId = c.req.header("X-Agent-Id") ?? "unknown"

  logger.info("Proxy request received", { credentialRef, method, url, agentId })

  // Step 1: Check allowlist (deterministic — Postgres lookup)
  const allowlistResult = await checkAllowlist(credentialRef, method, url)

  if (!allowlistResult.allowed) {
    logger.warn("Proxy request denied", {
      credentialRef,
      method,
      url,
      reason: allowlistResult.reason,
      agentId,
    })

    // Audit log the denial
    await db.insert(auditLog).values({
      credentialRef,
      agentId,
      method,
      url,
      decision: "denied",
      latencyMs: Math.round(performance.now() - startTime),
    })

    return c.json({ error: "Denied", reason: allowlistResult.reason }, 403)
  }

  // Step 2: Handle tier-based decisions
  const tier = allowlistResult.tier!

  if (tier === "always_ask" || tier === "ask_once") {
    // TODO: Nockerl Inbox approval flow (task #964)
    logger.warn("Approval required but not yet implemented", {
      credentialRef,
      tier,
      agentId,
    })

    await db.insert(auditLog).values({
      credentialRef,
      agentId,
      method,
      url,
      decision: "pending_approval",
      latencyMs: Math.round(performance.now() - startTime),
    })

    return c.json(
      { error: "Approval required", tier, message: "Human approval not yet implemented" },
      202,
    )
  }

  // TODO: Rate limiting for rate_limited tier (task #675)

  // Step 3: Fetch secret from Infisical (with cache)
  let secretValue: string
  try {
    const infisicalPath = allowlistResult.infisicalPath ?? "/"
    secretValue = await getSecret(credentialRef, infisicalPath)
  } catch (err) {
    logger.error("Failed to fetch secret", {
      credentialRef,
      error: err instanceof Error ? err.message : String(err),
    })

    await db.insert(auditLog).values({
      credentialRef,
      agentId,
      method,
      url,
      decision: "denied",
      metadata: { error: "Secret fetch failed" },
      latencyMs: Math.round(performance.now() - startTime),
    })

    return c.json({ error: "Secret retrieval failed" }, 500)
  }

  // Step 4: Inject credential and proxy the request
  try {
    const result = await injectAndProxy(secretValue, method, url, headers, body)

    // Audit log the success
    await db.insert(auditLog).values({
      credentialRef,
      agentId,
      method,
      url,
      decision: "allowed",
      responseStatus: result.status,
      latencyMs: result.latencyMs,
    })

    // Return clean response to agent (no credentials visible)
    return c.json({
      status: result.status,
      headers: result.headers,
      body: result.body,
    })
  } catch (err) {
    logger.error("Proxy request failed", {
      credentialRef,
      method,
      url,
      error: err instanceof Error ? err.message : String(err),
    })

    await db.insert(auditLog).values({
      credentialRef,
      agentId,
      method,
      url,
      decision: "denied",
      metadata: { error: "Outbound request failed" },
      latencyMs: Math.round(performance.now() - startTime),
    })

    return c.json({ error: "Proxy request failed" }, 502)
  }
})
