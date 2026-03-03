/**
 * Laurin configuration — loaded from environment variables.
 * On the Laurin VPS, these come from /etc/laurin/infisical.env
 */

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback
}

export const config = {
  // Server
  port: parseInt(optionalEnv("PORT", "3600"), 10),
  host: optionalEnv("HOST", "0.0.0.0"),
  nodeEnv: optionalEnv("NODE_ENV", "production"),

  // Database
  databaseUrl: requireEnv("LAURIN_DATABASE_URL"),

  // Infisical
  infisical: {
    clientId: requireEnv("INFISICAL_CLIENT_ID"),
    clientSecret: requireEnv("INFISICAL_CLIENT_SECRET"),
    projectId: requireEnv("INFISICAL_PROJECT_ID"),
    environment: optionalEnv("INFISICAL_ENVIRONMENT", "prod"),
    apiUrl: optionalEnv("INFISICAL_API_URL", "https://app.infisical.com"),
  },

  // Cache
  secretCacheTtlMs: parseInt(optionalEnv("SECRET_CACHE_TTL_MS", "60000"), 10),

  // Nockerl Gateway (for inbox notifications)
  gatewayUrl: optionalEnv("GATEWAY_URL", "http://100.112.204.112:3500"),
} as const

export type Config = typeof config
