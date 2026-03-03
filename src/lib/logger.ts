/**
 * Structured JSON logger for Laurin.
 * Writes to stdout so systemd journal captures it.
 */

type LogLevel = "debug" | "info" | "warn" | "error"

interface LogEntry {
  level: LogLevel
  msg: string
  timestamp: string
  [key: string]: unknown
}

function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    msg,
    timestamp: new Date().toISOString(),
    ...data,
  }
  const line = JSON.stringify(entry)

  if (level === "error") {
    console.error(line)
  } else {
    console.log(line)
  }
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
}
