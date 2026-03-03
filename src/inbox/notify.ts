/**
 * Nockerl Inbox integration for human-in-the-loop approvals.
 *
 * Sends approval requests to the Nockerl Gateway, which delivers
 * them via SSE + FCM push to Patrick's devices.
 *
 * TODO: Implement once Nockerl actionable notifications are ready (task #672 + #964)
 */
import { logger } from "../lib/logger.ts"

/** Send an approval request to Nockerl Inbox */
export async function requestApproval(
  _credentialRef: string,
  _method: string,
  _url: string,
  _agentId: string,
): Promise<{ approved: boolean; reason?: string }> {
  logger.warn("Nockerl Inbox approval not yet implemented — defaulting to deny")
  return { approved: false, reason: "Approval system not yet implemented" }
}
