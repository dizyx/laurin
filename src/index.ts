/**
 * Laurin — Local LLM Credential Proxy for AI Agents
 *
 * "Don't touch the roses."
 *
 * Entry point: Hono server on port 3600.
 * Two APIs: Proxy API (agents call) + Admin API (Claude manages structure).
 */
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger as honoLogger } from "hono/logger"
import { proxyRouter } from "./proxy/handler.ts"
import { adminRouter } from "./admin/routes.ts"
import { testConnection, closeDatabase } from "./db/index.ts"
import { config } from "./lib/config.ts"
import { logger } from "./lib/logger.ts"

const app = new Hono()

// Middleware
app.use("*", cors())
app.use("*", honoLogger())

// Health check
app.get("/health", async (c) => {
  const dbOk = await testConnection()
  const status = dbOk ? "healthy" : "degraded"

  return c.json({
    status,
    service: "laurin",
    version: "0.1.0",
    uptime: process.uptime(),
    database: dbOk ? "connected" : "disconnected",
  })
})

// Mount routers
app.route("/", proxyRouter)
app.route("/", adminRouter)

// 404 fallback
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404)
})

// Error handler
app.onError((err, c) => {
  logger.error("Unhandled error", {
    error: err.message,
    stack: err.stack,
    path: c.req.path,
    method: c.req.method,
  })
  return c.json({ error: "Internal server error" }, 500)
})

// Start server
logger.info("Starting Laurin", {
  port: config.port,
  host: config.host,
  env: config.nodeEnv,
})

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
})

logger.info("Laurin is running", {
  url: `http://${server.hostname}:${server.port}`,
  message: "Don't touch the roses.",
})

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("Shutting down...")
  await closeDatabase()
  process.exit(0)
})

process.on("SIGTERM", async () => {
  logger.info("Shutting down...")
  await closeDatabase()
  process.exit(0)
})
