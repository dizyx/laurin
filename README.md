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

Laurin is a credential proxy that sits on **your hardware**, between your AI agents and the APIs they need to call. Agents request actions by **reference** — they never see the actual secret values.

```
┌─────────────┐     "use github-dizyx     ┌─────────────┐    GET + real token
│  Cloud Agent │ ──── to GET /repos" ────→ │   Laurin    │ ─────────────────→  GitHub API
│  (Claude,    │     (no token, just       │  (your box, │
│   GPT, etc.) │      a reference name)    │   your LAN) │
└─────────────┘                            └─────────────┘
```

The agent says **what** it wants. Laurin decides **whether** it's allowed, injects the credential, makes the call, and returns the response — with any credential headers stripped.

## How It Works

### Three Trust Zones

1. **Cloud Zone (untrusted)** — Your cloud servers, AI agents, LLM providers. Can only call Laurin's proxy API endpoint.
2. **Home Zone (trusted)** — Dedicated hardware running Laurin on your local network, isolated via Tailscale ACLs. No SSH from cloud. API port only.
3. **Human Zone (fallback)** — Your laptop, your password manager. Agent-proof. Always accessible if Laurin goes down.

### Credential Tiers

| Tier | Behavior | Example |
|------|----------|---------|
| **Auto-allow** | Instant passthrough, just log | GitHub API reads, CDN fetches |
| **Rate-limited** | Passthrough with limits | GitHub API writes (max 20/hour) |
| **Ask once** | Ping human, allow for N hours | New API endpoint, new domain |
| **Always ask** | Every call needs human approval | Billing APIs, deletions, admin |

### Smart Local LLM

A small local model (Qwen, Devstral, etc.) runs alongside the proxy to:

- Manage allowlists — "I added a new GitHub token, set up typical API rules"
- Rotate credentials automatically via Infisical API
- Detect anomalies in audit logs
- Send weekly summaries via Telegram

The local LLM is deliberately small and isolated. It can't be prompt-injected remotely because it's not connected to any cloud LLM provider. It's a dumb, stubborn guard dog — and that's the point.

### Security Model

- **Physical trust boundary** — Laurin runs on separate hardware you own
- **Tailscale ACL lockdown** — Cloud servers can only reach the proxy API port (no SSH, no other services)
- **Domain allowlisting** — Each credential is locked to specific domains, methods, and paths
- **No credential in context** — The LLM never sees token values, not in prompts, not in responses
- **Audit logging** — Every credential use logged with agent ID, URL, method, timestamp

## Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **Framework:** [Hono](https://hono.dev)
- **Database:** PostgreSQL (allowlists + audit log)
- **Secret Storage:** [Infisical](https://infisical.com) (self-hosted or cloud)
- **Local LLM:** Any tool-use capable model (Qwen3-30B, Devstral, etc.)
- **Networking:** [Tailscale](https://tailscale.com) (ACL-restricted)
- **Notifications:** Telegram bot (human-in-the-loop approvals)
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
| Dwarf King — small but rules a kingdom | Small local LLM — limited but controls all credentials |
| Cloak of invisibility | Your secrets are invisible to cloud agents |
| Belt of 12 men's strength | Small model punches above its weight |
| "Touch my roses and lose your hand" | Hit an unauthorized URL and get blocked |
| Lives underground, hidden from the world | Lives on your home network, hidden behind Tailscale |

## License

TBD (likely MIT or Apache 2.0)

---

*Built by [dizyx](https://dizyx.com). Your data, your hardware, your rules.*
