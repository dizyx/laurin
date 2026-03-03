/**
 * Admin API for credential lifecycle management.
 *
 * Claude manages structure, Patrick manages values.
 * These endpoints create/read/update/delete credential metadata
 * and allowlist rules. They NEVER return secret values.
 */
import { Hono } from "hono"
import { z } from "zod"
import { db } from "../db/index.ts"
import { credentials, allowlistRules } from "../db/schema.ts"
import { eq } from "drizzle-orm"
import { createSecretPlaceholder } from "../secrets/infisical.ts"
import { logger } from "../lib/logger.ts"

const credentialTiers = ["auto_allow", "rate_limited", "ask_once", "always_ask", "catalog_only"] as const

const createCredentialSchema = z.object({
  refName: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/, "Must be lowercase alphanumeric with hyphens"),
  tier: z.enum(credentialTiers),
  description: z.string().min(1),
  catalogOnly: z.boolean().default(false),
  deployedTo: z
    .array(
      z.object({
        service: z.string(),
        environment: z.string(),
        notes: z.string().optional(),
      }),
    )
    .default([]),
  rateLimit: z
    .object({
      max: z.number().int().positive(),
      windowSeconds: z.number().int().positive(),
    })
    .nullable()
    .default(null),
  allowlistRules: z
    .array(
      z.object({
        domain: z.string().min(1),
        method: z.string().default("*"),
        pathPattern: z.string().default("/**"),
      }),
    )
    .default([]),
  createInfisicalPlaceholder: z.boolean().default(true),
})

const updateCredentialSchema = z.object({
  tier: z.enum(credentialTiers).optional(),
  description: z.string().min(1).optional(),
  catalogOnly: z.boolean().optional(),
  deployedTo: z
    .array(
      z.object({
        service: z.string(),
        environment: z.string(),
        notes: z.string().optional(),
      }),
    )
    .optional(),
  rateLimit: z
    .object({
      max: z.number().int().positive(),
      windowSeconds: z.number().int().positive(),
    })
    .nullable()
    .optional(),
})

const addRuleSchema = z.object({
  domain: z.string().min(1),
  method: z.string().default("*"),
  pathPattern: z.string().default("/**"),
})

export const adminRouter = new Hono()

// List all credentials (metadata only — never values)
adminRouter.get("/admin/credentials", async (c) => {
  const result = await db.select().from(credentials).orderBy(credentials.refName)
  return c.json({ credentials: result })
})

// Get a single credential by ref name
adminRouter.get("/admin/credentials/:ref", async (c) => {
  const ref = c.req.param("ref")
  const [credential] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.refName, ref))
    .limit(1)

  if (!credential) {
    return c.json({ error: `Credential "${ref}" not found` }, 404)
  }

  // Also fetch its allowlist rules
  const rules = await db
    .select()
    .from(allowlistRules)
    .where(eq(allowlistRules.credentialId, credential.id))

  return c.json({ credential, allowlistRules: rules })
})

// Create a new credential
adminRouter.post("/admin/credentials", async (c) => {
  const rawBody = await c.req.json()
  const parseResult = createCredentialSchema.safeParse(rawBody)

  if (!parseResult.success) {
    return c.json({ error: "Invalid request", details: parseResult.error.flatten() }, 400)
  }

  const data = parseResult.data

  // Check if credential already exists
  const [existing] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.refName, data.refName))
    .limit(1)

  if (existing) {
    return c.json({ error: `Credential "${data.refName}" already exists` }, 409)
  }

  // Create the credential
  const infisicalPath = data.catalogOnly ? null : "/"
  const [credential] = await db
    .insert(credentials)
    .values({
      refName: data.refName,
      tier: data.tier,
      description: data.description,
      catalogOnly: data.catalogOnly,
      deployedTo: data.deployedTo,
      rateLimit: data.rateLimit,
      infisicalPath: infisicalPath,
    })
    .returning()

  if (!credential) {
    return c.json({ error: "Failed to create credential" }, 500)
  }

  // Create allowlist rules
  if (data.allowlistRules.length > 0) {
    await db.insert(allowlistRules).values(
      data.allowlistRules.map((rule) => ({
        credentialId: credential.id,
        domain: rule.domain,
        method: rule.method,
        pathPattern: rule.pathPattern,
      })),
    )
  }

  // Create Infisical placeholder (if not catalog-only)
  if (!data.catalogOnly && data.createInfisicalPlaceholder) {
    try {
      await createSecretPlaceholder(
        data.refName,
        "/",
        `${data.description} — paste real value in Infisical UI`,
      )
      logger.info("Infisical placeholder created for new credential", {
        refName: data.refName,
      })
    } catch (err) {
      logger.warn("Failed to create Infisical placeholder (credential still created)", {
        refName: data.refName,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // TODO: Send Nockerl Inbox notification to Patrick (task #964)
  // "New credential 'github-dizyx' needs a value — open Infisical to paste it"

  logger.info("Credential created", {
    refName: data.refName,
    tier: data.tier,
    catalogOnly: data.catalogOnly,
    rulesCount: data.allowlistRules.length,
  })

  return c.json({ credential, message: "Created. Paste the secret value in Infisical UI." }, 201)
})

// Update credential metadata
adminRouter.put("/admin/credentials/:ref", async (c) => {
  const ref = c.req.param("ref")
  const rawBody = await c.req.json()
  const parseResult = updateCredentialSchema.safeParse(rawBody)

  if (!parseResult.success) {
    return c.json({ error: "Invalid request", details: parseResult.error.flatten() }, 400)
  }

  const [existing] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.refName, ref))
    .limit(1)

  if (!existing) {
    return c.json({ error: `Credential "${ref}" not found` }, 404)
  }

  const [updated] = await db
    .update(credentials)
    .set({
      ...parseResult.data,
      updatedAt: new Date(),
    })
    .where(eq(credentials.refName, ref))
    .returning()

  return c.json({ credential: updated })
})

// Delete a credential
adminRouter.delete("/admin/credentials/:ref", async (c) => {
  const ref = c.req.param("ref")

  const [existing] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.refName, ref))
    .limit(1)

  if (!existing) {
    return c.json({ error: `Credential "${ref}" not found` }, 404)
  }

  await db.delete(credentials).where(eq(credentials.refName, ref))

  logger.info("Credential deleted", { refName: ref })
  return c.json({ message: `Credential "${ref}" deleted` })
})

// Add an allowlist rule to a credential
adminRouter.post("/admin/credentials/:ref/rules", async (c) => {
  const ref = c.req.param("ref")
  const rawBody = await c.req.json()
  const parseResult = addRuleSchema.safeParse(rawBody)

  if (!parseResult.success) {
    return c.json({ error: "Invalid request", details: parseResult.error.flatten() }, 400)
  }

  const [credential] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.refName, ref))
    .limit(1)

  if (!credential) {
    return c.json({ error: `Credential "${ref}" not found` }, 404)
  }

  const [rule] = await db
    .insert(allowlistRules)
    .values({
      credentialId: credential.id,
      ...parseResult.data,
    })
    .returning()

  return c.json({ rule }, 201)
})

// Delete an allowlist rule
adminRouter.delete("/admin/rules/:ruleId", async (c) => {
  const ruleId = c.req.param("ruleId")

  await db.delete(allowlistRules).where(eq(allowlistRules.id, ruleId))

  return c.json({ message: "Rule deleted" })
})
