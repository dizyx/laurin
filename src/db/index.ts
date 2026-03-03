/**
 * Database connection for Laurin.
 * Uses Drizzle ORM with the postgres.js driver.
 */
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema.ts"
import { config } from "../lib/config.ts"
import { logger } from "../lib/logger.ts"

const queryClient = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
})

export const db = drizzle(queryClient, { schema })

/** Test the database connection */
export async function testConnection(): Promise<boolean> {
  try {
    await queryClient`SELECT 1`
    logger.info("Database connection verified")
    return true
  } catch (err) {
    logger.error("Database connection failed", {
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

/** Graceful shutdown */
export async function closeDatabase(): Promise<void> {
  await queryClient.end()
  logger.info("Database connection closed")
}
