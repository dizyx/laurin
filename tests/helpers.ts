/**
 * Test helpers for Laurin integration tests.
 *
 * Creates a Hono app instance that can be tested with app.request()
 * without needing a running server. Uses the real database on the
 * Laurin VPS (via Tailscale) for integration tests.
 */
import { Hono } from "hono"
import { proxyRouter } from "../src/proxy/handler.ts"
import { adminRouter } from "../src/admin/routes.ts"
import { db } from "../src/db/index.ts"
import { credentials, allowlistRules, auditLog } from "../src/db/schema.ts"

/** Create a fresh Hono app for testing */
export function createTestApp(): Hono {
  const app = new Hono()
  app.route("/", proxyRouter)
  app.route("/", adminRouter)

  app.get("/health", (c) => c.json({ status: "ok" }))

  return app
}

/** Clean all test data from the database */
export async function cleanTestData(): Promise<void> {
  await db.delete(auditLog)
  await db.delete(allowlistRules)
  await db.delete(credentials)
}

/** Helper to make JSON requests to the test app */
export async function jsonRequest(
  app: Hono,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  }

  if (body) {
    init.body = JSON.stringify(body)
  }

  const response = await app.request(path, init)
  const responseBody = await response.json()

  return { status: response.status, body: responseBody }
}
