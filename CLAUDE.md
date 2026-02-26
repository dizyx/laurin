# Laurin

**Workspace:** dizyx
**Status:** design & planning
**Runtime:** Bun (never Node.js)

Local LLM credential proxy for AI agents. Agents request credentials by reference name, Laurin validates against allowlists and injects the real token into the outbound request. The agent never sees the secret value.

## Project Definition

- **Dashboard:** https://nockerl.dizyx.com/projects/laurin
- **Idea #50:** Full architecture, competitive research, security model, and design notes are stored in Idea #50 in the Nockerl Dashboard. Query the dashboard API to read the complete project definition:
  ```
  GET https://nockerl.dizyx.com/api/ideas/50
  ```
- **Research doc:** ~/research/agent-credential-injection-research.md (deep technical research on credential isolation patterns, 30+ competitor analysis)

## Architecture Overview

Three trust zones:
1. **Cloud Zone (untrusted)** — Hetzner servers, Claude Code agents. Can ONLY call Laurin's proxy API.
2. **Home Zone (trusted)** — Dedicated Asus Ascent running Laurin. Tailscale ACL: API port only, no SSH from cloud.
3. **Human Zone (fallback)** — Patrick's laptop + Proton Pass. Agent-proof, always accessible.

Core flow:
1. Cloud agent sends: `{ credential_ref: "github-dizyx", method: "GET", url: "https://api.github.com/repos/dizyx/laurin" }`
2. Laurin checks allowlist: is this ref + domain + method + path allowed?
3. If allowed → fetch token from Infisical, inject into request, make the call, return response (headers stripped)
4. If new/unusual → Telegram ping to Patrick for approval
5. Agent sees only the response body. Never the token.

## Tech Stack

- **Runtime:** Bun
- **Framework:** Hono
- **Database:** Postgres via Drizzle ORM (allowlists, audit log, credential metadata)
- **Secret Storage:** Infisical (actual token values live here, not in Postgres)
- **Local LLM:** Qwen3-30B or similar (tool-use focused, manages allowlists and rotation)
- **Networking:** Tailscale (ACL-restricted)
- **Notifications:** Telegram bot (human-in-the-loop approvals)
- **Protocol:** MCP server (so any AI tool can use the proxy)

## Key Design Decisions

- **Physical trust boundary** — Software can't fully protect against software. The trust boundary is a separate physical machine.
- **Dumb guard dog** — The local LLM is deliberately small. Most operations are table lookups, not complex reasoning. Too simple to be outsmarted by prompt injection.
- **Credential tiers** — Auto-allow (trusted), rate-limited, ask-once (temporary approval), always-ask (high risk).
- **Domain allowlisting is non-negotiable** — Each credential ref is locked to specific domains to prevent echo-header attacks.
- **No credentials in LLM context, ever** — Not in prompts, not in env vars, not in tool outputs.

## Development

```bash
# Install dependencies
bun install

# Start dev server
bun run dev

# Run tests
bun test

# Type check
bunx tsc --noEmit
```

## Git Workflow

Conventional commits:
```
feat:     New feature
fix:      Bug fix
refactor: Code restructuring
docs:     Documentation
test:     Adding tests
chore:    Maintenance
```

Co-author line:
```
Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```
