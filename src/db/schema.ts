/**
 * Drizzle ORM schema for Laurin's Postgres database.
 *
 * Tables:
 * - credentials: credential metadata (ref name, tier, infisical path, etc.)
 * - allowlistRules: domain/method/path patterns for each credential
 * - auditLog: every proxy request is logged here
 */
import { pgTable, text, uuid, boolean, jsonb, integer, timestamp, pgEnum } from "drizzle-orm/pg-core"

// Enums
export const credentialTierEnum = pgEnum("credential_tier", [
  "auto_allow",
  "rate_limited",
  "ask_once",
  "always_ask",
  "catalog_only",
])

export const proxyDecisionEnum = pgEnum("proxy_decision", [
  "allowed",
  "denied",
  "rate_limited",
  "pending_approval",
  "approved",
  "rejected",
])

// Tables
export const credentials = pgTable("credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  refName: text("ref_name").notNull().unique(),
  tier: credentialTierEnum("tier").notNull().default("auto_allow"),
  description: text("description").notNull().default(""),
  infisicalPath: text("infisical_path"),
  catalogOnly: boolean("catalog_only").notNull().default(false),
  deployedTo: jsonb("deployed_to").notNull().default([]),
  rateLimit: jsonb("rate_limit"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const allowlistRules = pgTable("allowlist_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  credentialId: uuid("credential_id")
    .notNull()
    .references(() => credentials.id, { onDelete: "cascade" }),
  domain: text("domain").notNull(),
  method: text("method").notNull().default("*"),
  pathPattern: text("path_pattern").notNull().default("/**"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  credentialRef: text("credential_ref").notNull(),
  agentId: text("agent_id"),
  method: text("method").notNull(),
  url: text("url").notNull(),
  decision: proxyDecisionEnum("decision").notNull(),
  responseStatus: integer("response_status"),
  latencyMs: integer("latency_ms"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

// Type exports for use in application code
export type Credential = typeof credentials.$inferSelect
export type NewCredential = typeof credentials.$inferInsert
export type AllowlistRule = typeof allowlistRules.$inferSelect
export type NewAllowlistRule = typeof allowlistRules.$inferInsert
export type AuditLogEntry = typeof auditLog.$inferSelect
export type NewAuditLogEntry = typeof auditLog.$inferInsert
