# Laurin

**Workspace:** dizyx
**Status:** Phase 1 — Core Proxy (code written, deploying to VPS)
**Runtime:** Bun (never Node.js)

Local LLM credential proxy for AI agents. Agents request credentials by reference name, Laurin validates against allowlists and injects the real token into the outbound request. The agent never sees the secret value.

## Project Definition

- **Dashboard:** https://nockerl.dizyx.com/projects/laurin (Project #70)
- **Project-level CLAUDE.md:** ~/dizyx/projects/laurin/CLAUDE.md (build phases, task tracker, infrastructure details)
- **Research doc:** ~/research/agent-credential-injection-research.md (deep technical research on credential isolation patterns, 30+ competitor analysis)

## Architecture Overview (Updated 2026-03-02)

Three machines, three trust levels:

1. **Laurin Proxy (Hetzner CAX11, €3.99/mo)** — Dedicated VPS (46.225.222.152, ARM64, 4GB RAM). Bun + Hono + Postgres. No agents, no Claude Code, no shell access from cloud. Secret values never leave this machine. SSH: `ssh laurin`
2. **Gateway (Hetzner Server 2, 46.225.186.190)** — Nockerl Gateway + Claude Code agents. Agents call Laurin via Tailscale (port 3600 only). Cannot SSH to Laurin.
3. **DGX Spark (100.90.15.48)** — Local LLM for judgment calls. Laurin calls OUT to the LLM. LLM never sees secret values — only ref names, domains, audit summaries.
4. **Human Zone (fallback)** — Patrick's laptop + Infisical Cloud web UI. Agent-proof, always accessible.

Core flow:
1. Cloud agent sends: `{ credential_ref: "github-dizyx", method: "GET", url: "https://api.github.com/repos/dizyx/laurin" }`
2. Laurin checks allowlist: is this ref + domain + method + path allowed? (deterministic — Postgres lookup)
3. If allowed → fetch token from Infisical (60s cache), inject into request, make the call, return response (headers stripped)
4. If new/unusual pattern → call local LLM for judgment, or Nockerl Inbox notification for human approval
5. Agent sees only the response body. Never the token.

### What the Local LLM Decides (and Doesn't)

| Scenario | Decision Maker | How |
|----------|---------------|-----|
| Known credential + known pattern | **Deterministic code** | Postgres lookup, instant |
| Rate-limited tier | **Deterministic code** | Counter check, instant |
| New/unknown endpoint pattern | **Local LLM** | "Is this consistent with typical usage?" |
| Ask-once tier (first time) | **Nockerl Inbox** | Human approval |
| Always-ask tier | **Nockerl Inbox** | Human approval every time |
| Anomaly detection | **Local LLM** | Reviews audit logs on schedule |
| Allowlist generation | **Local LLM** | Suggests rules for new credentials |

The LLM NEVER sees actual secret values. It works with: credential reference names, domain patterns, HTTP methods, path patterns, audit log summaries.

### Credential Tiers

| Tier | Behavior | Decision Maker | Example |
|------|----------|---------------|---------|
| auto-allow | Instant passthrough, just log | Deterministic code | GitHub API reads, CDN fetches |
| rate-limited | Passthrough with limits | Deterministic code | GitHub API writes (max 20/hour) |
| ask-once | Approve for N hours | Human (Nockerl Inbox) | New API endpoint, new domain |
| always-ask | Every call needs approval | Human (Nockerl Inbox) | Billing APIs, deletions, admin |
| catalog-only | Metadata only, no proxy | N/A | Deployed app credentials (Heroku, Coolify) |

## Tech Stack

- **Runtime:** Bun
- **Framework:** Hono
- **Database:** Postgres via Drizzle ORM (allowlists, audit log, credential metadata)
- **Secret Storage:** Infisical Cloud (free tier, REST API) + SOPS/age backup
- **Local LLM:** Qwen3-30B or Devstral on DGX Spark (tool-use focused, via Tailscale)
- **Networking:** Tailscale (ACL-restricted)
- **Approvals:** Nockerl Inbox (actionable notifications + FCM push to Android app)
- **Protocol:** MCP server (so any AI tool can use the proxy)

## Key Design Decisions

- **Physical trust boundary** — Dedicated VPS with no agent access. Software can't fully protect against software.
- **Deterministic > LLM** — 95% of requests are pure table lookups. LLM only for edge cases and admin.
- **Dumb guard dog** — The local LLM is deliberately small. Too simple to be outsmarted by prompt injection.
- **Credential tiers** — Auto-allow (trusted), rate-limited, ask-once (temporary approval), always-ask (high risk), catalog-only (metadata tracking).
- **Domain allowlisting is non-negotiable** — Each credential ref is locked to specific domains to prevent echo-header attacks.
- **No credentials in LLM context, ever** — Not in prompts, not in env vars, not in tool outputs. Not even the local LLM.
- **Secrets only touched by deterministic code** — Application code fetches from Infisical, injects into requests. No LLM in the loop for credential handling.
- **Claude manages structure, Patrick manages values** — Admin API creates credential metadata + Infisical placeholder. Patrick pastes actual key in Infisical UI. Nobody waits, nobody SSHs.

## Database Schema (Planned)

```
credentials
├── id (uuid, pk)
├── ref_name (text, unique) — "github-dizyx", "bunny-cdn", etc.
├── tier (enum) — auto_allow, rate_limited, ask_once, always_ask, catalog_only
├── infisical_path (text, nullable) — path in Infisical where secret is stored
├── description (text) — what this credential is for
├── catalog_only (boolean) — true = metadata only, no proxy
├── deployed_to (jsonb[]) — where this credential is deployed (for catalog-only)
├── rate_limit (jsonb, nullable) — {max: 20, window_seconds: 3600}
├── created_at, updated_at

allowlist_rules
├── id (uuid, pk)
├── credential_id (uuid, fk → credentials)
├── domain (text) — "api.github.com"
├── method (text) — "GET", "POST", "*"
├── path_pattern (text) — "/repos/**", "/user/*"
├── created_at

audit_log
├── id (uuid, pk)
├── credential_ref (text)
├── agent_id (text, nullable)
├── method (text)
├── url (text)
├── decision (enum) — allowed, denied, rate_limited, pending_approval, approved, rejected
├── response_status (int, nullable)
├── latency_ms (int, nullable)
├── created_at
```

## Project Structure (Planned)

```
src/
├── index.ts              # Hono app entry point
├── proxy/
│   ├── handler.ts        # POST /proxy endpoint
│   ├── allowlist.ts      # Allowlist validation logic
│   └── injector.ts       # Credential injection + header stripping
├── admin/
│   ├── routes.ts         # CRUD endpoints for /admin/credentials
│   └── infisical.ts      # Infisical placeholder creation
├── secrets/
│   ├── infisical.ts      # Infisical REST API client + cache
│   ├── sops.ts           # SOPS/age fallback reader
│   └── cache.ts          # In-memory cache (60s TTL)
├── db/
│   ├── schema.ts         # Drizzle schema definitions
│   ├── migrate.ts        # Migration runner
│   └── index.ts          # DB connection
├── inbox/
│   └── notify.ts         # Nockerl Inbox integration
├── llm/
│   └── client.ts         # DGX Spark LLM client (via Tailscale)
└── lib/
    ├── logger.ts         # Structured JSON logging
    ├── config.ts         # Environment config
    └── types.ts          # Shared types
```

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

## Functional Programming Style

Prefer:
- Pure functions over classes
- Composition over inheritance
- Explicit error handling (Result types or thrown errors, no silent failures)
- Immutable data where practical
