# Adoption Scenarios — Is gijun-ai right for you?

> This document answers "should I use gijun-ai?" by scenario, not by feature.
> The short version: gijun-ai is useful if you want to **learn** how a local
> audit / HITL / policy layer is built, or if you want to **reference** the
> architecture when building your own. It is **not** useful as a production
> dependency for a team, because it is a deliberately single-user tool.

---

## Scenario matrix

| Scenario | Fit | Why |
|----------|:---:|-----|
| **Personal learning** — studying how an audit chain, HITL gate, and MCP bridge are wired together in ~3,500 LOC | ✓ | The codebase is small (`packages/core` + `packages/server` + `packages/mcp-server`), each module has a narrow interface, and `docs/project-framework.md` explains the 5 axes. Read it in one sitting. |
| **Reference implementation** — forking to build your own audit / governance layer for a different stack | ✓ | MIT license permits this. The architecture is intentionally legible (monorepo, clear module boundaries, documented contracts). Fork, adapt, rename. |
| **Portfolio artifact** — linking to demonstrate your engineering work | △ | Acceptable **after** the L2 DoD checklist is green. Before then, the documented-but-not-enforced v0.1.0 ASI08 claim in the git history is a negative signal in a portfolio review. See `docs/public-status-dod.md`. |
| **Solo developer's personal workflow** — a single developer wanting to audit their own Claude Code sessions | ✓ (cautious) | This is the design target. Expect friction: manual token generation, CLI-only, no UI. If that's fine, `pnpm init && pnpm build` and you're running. |
| **Team adoption** — multiple developers sharing a server instance | ✗ | **Not supported.** Single shared token = no per-user accountability. HITL approval cannot validate who actually approved. This is not an oversight; it is the C-1a scope decision. Fork for RBAC. |
| **Production dependency** — staging / prod reliance on the audit chain for compliance evidence | ✗ | No CI / no SLA on security patches / no multi-instance replication / no external auditor verification procedure. See `docs/public-status-dod.md` — L4 is out of scope. |
| **Regulatory compliance substrate** (SOC2 / ISO27001 / HIPAA) | ✗ | The audit chain is technically sound for a single-instance local record, but compliance requires far more (access controls, retention policy, disaster recovery, documented operational runbooks, auditor attestation). gijun-ai provides **none** of this ceremony. Use a vendor that does (Langfuse, Arize, etc.) or fork and build it. |

---

## When to reach for something else

If your situation maps to any of the `✗` rows above, consider these alternatives instead:

- **Team observability for LLM calls** — [Langfuse](https://langfuse.com/) (self-host or cloud), [Arize Phoenix](https://docs.arize.com/phoenix) (OSS)
- **Production audit trail with compliance story** — build on top of your existing SIEM or use a vendor with certifications
- **Agent policy enforcement for a team** — your IAM provider + a policy decision point (OPA, Cerbos) you already operate

gijun-ai was built because none of those were the right fit for a single developer who wanted **local-first, no-cloud, no-vendor-lock, single-file SQLite** observability over their own AI agent use. If that is your constraint, gijun-ai is the answer. If not, there are better options.

---

## Expected friction (be honest before installing)

Installing gijun-ai requires roughly this sequence:

1. Clone, `pnpm install`, `pnpm build`
2. `openssl rand -hex 32` for a token; `export AGENTGUARD_TOKEN=…`
3. `export AGENTGUARD_DB_PATH=…`; start server
4. `curl` health check
5. Edit Claude Code `.mcp.json` to register the MCP server
6. Restart Claude Code

Total: **~5 minutes**. The demo value of step 4 is: an API response saying `{"id": 1}`. There is no UI. There is no dashboard showing your audit events as a timeline — you can `GET /audit?n=20` but interpretation is manual.

If you want one-command installation and a pretty dashboard, gijun-ai is not there yet (UI is on the `packages/web` roadmap but is not shipped in v0.1).

---

## Single-user scope is a commitment, not a limitation

It would be technically easy to add multi-user tokens, an RBAC layer, and per-user audit attribution. The decision **not** to do that is an architecture commitment — it keeps the auth model simple, keeps the audit chain content-addressable without identity smearing, and keeps the threat model honest ("host physical access").

If you need multi-user, the correct path is to **fork and extend** — the architecture is designed for that. Upstream will stay single-user.
