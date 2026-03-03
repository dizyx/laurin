# Laurin 🌹

**A local LLM credential proxy for AI agents.**

Named after [Laurin, the Dwarf King of the Dolomites](https://en.wikipedia.org/wiki/Laurin) — small but fierce, guarding his mountain treasures with a cloak of invisibility. The bigger knights couldn't be trusted with his roses.

> *"Don't touch the roses."*

## The Problem

AI agents need API keys and tokens to do useful work. But:

- If the token is in the LLM's context, it gets sent to cloud providers (Anthropic, OpenAI)
- Prompt injection can extract any secret the agent can see
- Agents with shell access can sniff network traffic, read files, monitor processes
- Enterprise solutions (CyberArk, Aembit, 1Password Agentic) are cloud SaaS — your secrets still leave your infrastructure

**There is no simple, self-hosted, open source solution for keeping credentials out of AI agent contexts.**

## The Solution

Laurin is a credential proxy that sits on **a dedicated server your agents can't access**, between your AI agents and the APIs they need to call. Agents request actions by **reference** — they never see the actual secret values.

```
┌─────────────┐     "use github-dizyx     ┌─────────────┐    GET + real token
│  Cloud Agent │ ──── to GET /repos" ────→ │   Laurin    │ ─────────────────→  GitHub API
│  (Claude,    │     (no token, just       │  (dedicated │
│   GPT, etc.) │      a reference name)    │   VPS)      │
└─────────────┘                            └─────────────┘
```

The agent says **what** it wants. Laurin decides **whether** it's allowed, injects the credential, makes the call, and returns the response — with any credential headers stripped.

## How It Works

### Architecture: Three Machines, Three Trust Levels

```
┌─────────────────────────────────────────────────────┐
│  Gateway Server (Hetzner)                            │
│  AI agents + Claude Code (untrusted shell access)    │
│  Can ONLY call Laurin API port via Tailscale         │
└─────────────┬───────────────────────────────────────┘
              │ Tailscale (port 3600 only)
              ▼
┌─────────────────────────────────────────────────────┐
│  Laurin VPS (Hetzner CX22, ~€4/month)               │
│  Proxy server + Postgres + secret storage            │
│  No agents, no Claude Code, no shell from cloud      │
│  Deterministic code only — secrets never leave here  │
└─────────────┬───────────────────────────────────────┘
              │ Tailscale (LLM port only, outbound)
              ▼
┌─────────────────────────────────────────────────────┐
│  DGX Spark (home network)                            │
│  Local LLM for judgment calls (Qwen3-30B, etc.)     │
│  Never sees secret values — only ref names, patterns │
└─────────────────────────────────────────────────────┘
```

**Key principle:** The local LLM never touches credentials. 95% of requests are pure deterministic code (Postgres lookup → allow/deny → inject → proxy). The LLM only handles edge cases: new endpoint patterns, anomaly detection, allowlist generation.

### Credential Tiers

| Tier | Behavior | Decision Maker | Example |
|------|----------|---------------|---------|
| **Auto-allow** | Instant passthrough, just log | Deterministic code | GitHub API reads, CDN fetches |
| **Rate-limited** | Passthrough with limits | Deterministic code | GitHub API writes (max 20/hour) |
| **Ask once** | Approve for N hours | Human (Nockerl Inbox) | New API endpoint, new domain |
| **Always ask** | Every call needs approval | Human (Nockerl Inbox) | Billing APIs, deletions, admin |

### Smart Local LLM

A small local model (Qwen, Devstral, etc.) runs on separate hardware and handles administrative tasks:

- Manage allowlists — "I added a new GitHub token, set up typical API rules"
- Evaluate new request patterns — "Is this consistent with typical usage?"
- Detect anomalies in audit logs
- Send weekly summaries via Nockerl Inbox

The local LLM is deliberately small and isolated. It can't be prompt-injected remotely because it's not connected to any cloud LLM provider. And critically — **it never sees secret values**. It works with reference names, domain patterns, and audit summaries. The actual credential injection is handled entirely by deterministic application code.

### Security Model

- **Physical trust boundary** — Laurin runs on a dedicated VPS that agents cannot access
- **Tailscale ACL lockdown** — Cloud servers can only reach the proxy API port (no SSH, no Postgres, no other services)
- **Domain allowlisting** — Each credential is locked to specific domains, methods, and paths
- **No credential in any LLM context** — Not in cloud LLMs, not in local LLMs. Secrets are only touched by deterministic code.
- **Audit logging** — Every credential use logged with agent ID, URL, method, timestamp
- **Human-in-the-loop** — Nockerl Inbox with actionable notifications + FCM push for approvals

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Framework:** [Hono](https://hono.dev)
- **Database:** PostgreSQL (allowlists + audit log)
- **Secret Storage:** [Infisical](https://infisical.com) Cloud (free tier, E2E encrypted) + SOPS/age backup
- **Local LLM:** Any tool-use capable model on DGX Spark (Qwen3-30B, Devstral, etc.)
- **Networking:** [Tailscale](https://tailscale.com) (ACL-restricted)
- **Approvals:** [Nockerl](https://nockerl.dizyx.com) Inbox (actionable notifications + FCM push)
- **Protocol:** MCP server for universal AI tool compatibility

## Project Status

**Phase: Design & Planning**

This project is in early design. The architecture and research are documented in the [Nockerl Dashboard](https://nockerl.dizyx.com/projects/laurin) (Idea #50).

Competitive research covering 30+ products in the AI agent identity space (Aembit, CyberArk, Astrix, Infisical, SPIFFE/SPIRE, etc.) found no simple open source solution solving the credential proxy pattern.

## Project Structure

```
~/dizyx/projects/laurin/
├── CLAUDE.md                    # Project-level instructions for AI sessions
└── repos/
    └── laurin/                  # This repository
        ├── README.md            # You are here
        ├── src/
        │   ├── proxy/           # Credential proxy server (Hono)
        │   ├── admin/           # Local LLM admin interface
        │   ├── db/              # Postgres schema (Drizzle ORM)
        │   └── lib/             # Shared utilities
        └── ...
```

## Name

From Tyrolean/Austrian Alpine legend:

| Legend | Laurin (the project) |
|-------|---------------------|
| Dwarf King — small but rules a kingdom | Small proxy — limited but controls all credentials |
| Cloak of invisibility | Your secrets are invisible to cloud agents |
| Belt of 12 men's strength | Small server punches above its weight |
| "Touch my roses and lose your hand" | Hit an unauthorized URL and get blocked |
| Lives underground, hidden from the world | Lives on a locked-down VPS, hidden behind Tailscale |

## License

TBD (likely MIT or Apache 2.0)

---

*Built by [dizyx](https://dizyx.com). Your data, your hardware, your rules.*
