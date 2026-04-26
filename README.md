[English](./README.md) · [한국어](./README.ko.md)

# gijun-ai

> **Set the standard. Verify the work. Learn from the session.**
>
> A personal single-user audit/verification workbench — audit, verify, and learn from every Claude/LLM session that changes something that matters.

![version](https://img.shields.io/github/package-json/v/aniboy2k-gif/gijun-AI?color=blue)
![license](https://img.shields.io/badge/license-MIT-green)
![node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)
![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A59-orange)
![status](https://img.shields.io/badge/status-v0.2%20alpha-yellow)

**Status: personal single-user tool — not a production dependency.** The HITL gate is a self-approval speed-bump for a solo developer, not multi-party governance. Fork the project if you need team mode, RBAC, or multi-user separation-of-duties.

---

## Why gijun-ai

Solo developers running Claude Max or similar agent tiers do serious work — ship code, touch production, edit policy documents — but the agent's reasoning, approvals, and cost footprint evaporate the moment the session ends. There's no audit trail you'd trust in a dispute, no gate to stop a half-verified idea from being executed, no memory that survives a `/clear`.

**gijun-ai** is a local-first audit/verification layer that sits between you and your agent:

- **Audit** every decision to an append-only SHA-256 hash chain that survives redaction
- **Verify** critical actions through a 4-axis HITL (human-in-the-loop) gate before they run
- **Learn** from incidents by promoting candidate patterns into a searchable knowledge base
- **Bound** cost with advisory budget policies that tell the caller when to stop — without enforcing
- **Expose** all of this through a REST API, a Model Context Protocol (MCP) server, and a local CLI

It runs as three Node packages against a single SQLite file on `127.0.0.1`. No cloud dependency, no team mode, no auth provider — just a disciplined record of what the agent did, and a gate to stop it before it does the wrong thing.

---

## Table of contents

1. [Quick start](#quick-start)
2. [Architecture contracts](#architecture-contracts)
3. [Module map](#module-map)
4. [REST API reference](#rest-api-reference)
5. [MCP tools reference](#mcp-tools-reference)
6. [Security model](#security-model)
7. [OWASP ASI mapping](#owasp-asi-mapping)
8. [Known limitations](#known-limitations)
9. [Roadmap](#roadmap)
10. [Development](#development)
11. [License](#license)

---

## Quick start

### Prerequisites

- Node.js ≥ 22 (native `node:sqlite`)
- pnpm ≥ 9
- macOS / Linux (Windows untested)

### Install

```bash
git clone https://github.com/aniboy2k-gif/gijun-AI.git
cd gijun-AI
pnpm install
pnpm build
```

### Generate a token and start the server

```bash
# 32-byte hex token — fail-closed, required
export AGENTGUARD_TOKEN="$(openssl rand -hex 32)"
export AGENTGUARD_DB_PATH="$(pwd)/gijun.db"

node packages/server/dist/server.js
# → [agentguard] server listening on http://127.0.0.1:3456
```

### Verify it works

```bash
curl -s http://127.0.0.1:3456/health
# → {"ok":true,"version":"<package.json version>"}  # e.g. "0.2.0"

curl -s -X POST http://127.0.0.1:3456/tasks \
  -H "X-AgentGuard-Token: $AGENTGUARD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"First task","complexity":"trivial"}'
# → {"id":1}
```

### Connect as an MCP server

In Claude Code `.mcp.json`:

```json
{
  "mcpServers": {
    "gijun-ai": {
      "command": "node",
      "args": ["/absolute/path/to/gijun-ai/packages/mcp-server/dist/index.js"],
      "env": {
        "AGENTGUARD_TOKEN": "<same token as REST API>",
        "AGENTGUARD_SERVER_URL": "http://127.0.0.1:3456"
      }
    }
  }
}
```

Or run it over HTTP:

```bash
AGENTGUARD_MCP_TRANSPORT=http \
AGENTGUARD_MCP_PORT=3457 \
AGENTGUARD_MCP_TOKEN="$(openssl rand -hex 32)" \
AGENTGUARD_TOKEN="$AGENTGUARD_TOKEN" \
  node packages/mcp-server/dist/index.js
```

---

## Architecture contracts & verification status

Six hard rules the implementation holds itself to. Every new feature must pass each one. The `Status` column marks whether the contract is asserted by an automated test (`[passed]`), has only unit coverage and needs end-to-end verification (`[pending E2E]`), or is not yet asserted (`[unverified]`).

| # | Contract | Enforcement | Status |
|---|----------|-------------|:------:|
| 1 | **Append-only audit** — existing audit rows are never mutated, only new rows appended | SQL `UPDATE`/`DELETE` absent on `audit_events`; hash chain verification in `POST /audit/integrity-check` | `[passed]` |
| 2 | **Full migration chain preflight** — server refuses to serve until every known migration is applied in order | `assertSchemaChain([...])` called before `app.listen()` in `server.ts` | `[passed]` |
| 3 | **Content-addressable redaction** — redaction replaces `payload` but keeps `original_hash`, so integrity survives takedowns | `audit_events.original_hash` column + chain links through `original_hash`, not the mutable payload | `[passed]` |
| 4 | **Fail-closed authentication** — server exits at startup without `AGENTGUARD_TOKEN`; every route requires the header | Startup guard in `server.ts` + `requireToken` middleware on every router except `/health` | `[pending E2E]` |
| 5 | **Local-only binding** — listen address is `127.0.0.1`, never a public interface | Hardcoded `HOST` in `server.ts` and `transports.ts` | `[unverified]` |
| 6 | **HITL gate before irreversibility** — single-user self-approval is required before a task can transition to `done` | `evaluateHitl()` in `hitl/gate.ts` + `POST /tasks/:id/hitl-approve` + status-transition guard in `updateTaskStatus` (v0.1.1) | `[passed]` (v0.1.1) |

---

## Module map

Eight `@gijun-ai/core` modules. Each is a state machine with a narrow public surface and a private schema.

### 1. Audit — hash-linked ledger

Every event is SHA-256 chained over `(prev_chain_hash, content_hash)`, where `content_hash` is derived from `original_hash` (not the redactable `payload`). This means a deletion request that blanks `payload` for a subject-access-rights compliance case does **not** break the chain — `verifyChain()` still reports `valid: true` because it verifies against `original_hash`.

Key file: `packages/core/src/audit/service.ts`

### 2. Task + HITL Gate

The HITL surface has two distinct entry points; the README/CHANGELOG abbreviation "4-axis" referred to the second one and is preserved below for the legacy reference.

**Step-level — `evaluateStepHitl(ctx)`** *(was `evaluateHitl`, deprecated since v0.1.3)*. Returns the first triggering reason for a single proposed action, or `null`. Five reasons across four underlying axes:
- `irreversible` — action string matches a destructive pattern (`DROP TABLE`, `rm -rf`, `git push --force`, …)
- `blast_radius` — `external` scope
- `complexity` — `critical` complexity
- `verify_fail` — verification verdict is `fail`
- `low_confidence` — verification confidence below 0.7 (verification axis sub-case)

**Task-level — `evaluateTaskHitl(input, opts?)`** *(was `evaluateHitlForTask`, deprecated since v0.1.3)*. Called by `createTask`. Returns `{ hitlRequired, trigger }`. Records up to four axes in the trigger payload:
- `critical_complexity` — `critical` always requires HITL
- `complex_complexity` — `complex` requires HITL when full context (`toolName`/`actionType`/`resource`) is present
- `incomplete_context` — `complex` without context
- `strict_mode_downgraded` — `complex` without context with `GIJUN_HITL_STRICT_MODE!=1` (warning, lets through; v0.1.2 will flip the default)

The operator (you — gijun-ai is single-user) must explicitly call `POST /tasks/:id/hitl-approve` before a task can transition to `done`. This is a self-approval speed-bump against a forgetful runaway agent, not multi-party governance; fork the project if you need separation-of-duties.

Key files: `packages/core/src/task/service.ts`, `packages/core/src/hitl/gate.ts`

### 3. Playbook — procedural memory

Human-authored procedures that the agent can reference before acting. Identified by slug (unique) or numeric id. Versioned via `updated_at`; list/search features deferred to v0.2.

Key file: `packages/core/src/playbook/service.ts`

### 4. Knowledge — FTS5 with 4 layers

Full-text search over `knowledge_items` using SQLite's FTS5 with a trigram tokenizer. Four layers of confidence: `global | project | incident | candidate`. Candidates can be promoted into the incident layer via an atomic transaction that also writes an audit event.

Key file: `packages/core/src/knowledge/retriever.ts`

### 5. Incident — pattern promotion

Reports an AI-caused failure and, as similar reports accumulate, promotes a candidate pattern into the reusable incident layer once an operator explicitly approves.

Key file: `packages/core/src/incident/service.ts`

### 6. Policy Engine — standard | budget discriminated union

Two policy kinds, one table, one Zod `discriminatedUnion`:

- **Standard** policies: classic allow/deny with optional `rate_limit`, scoped by `toolName × actionType × resource`
- **Budget** policies: cost limits using `CostLimitConditions { period, usd_limit, warning_threshold, critical_threshold }`

Selection is deterministic: most-specific wins, `priority DESC` as tie-breaker, then `created_at DESC`.

Key file: `packages/core/src/policy/engine.ts`

### 7. Verify Strategy — sampling mode

Decides whether a given task step needs a secondary verifier. Deterministic sampling (hash-based) prevents adversarial bypass.

Key file: `packages/core/src/verify/strategy.ts`

### 8. Tracer + Cost Budget — 7-state advisory

Token/latency/cost traces recorded per step. `checkBudget(scope)` returns one of seven advisory statuses:

| status | meaning |
|--------|---------|
| `no_policy` | no matching budget policy found |
| `no_cost_data` | policy exists but no traces in the period |
| `under_budget` | below warning threshold |
| `warning` | ≥ warning_threshold (default 0.8) |
| `critical` | ≥ critical_threshold (default 0.95) |
| `over_budget` | ≥ limit — caller decides what to do |
| `invalid` | policy JSON failed schema validation |

`warning | critical | over_budget | invalid` are auto-appended to the audit log. **The function does not enforce**; the caller (agent, policy evaluator, human) decides the action. Supported periods: `1h | 24h | 7d | 30d | mtd` (month-to-date, UTC).

Key file: `packages/core/src/tracer/service.ts`

---

## REST API reference

All routes except `GET /health` require the `X-AgentGuard-Token` header. Base URL: `http://127.0.0.1:3456`.

### Health

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| GET | `/health` | — | Liveness probe + version. |

### `/tasks` — tracked tasks

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| GET | `/tasks` | ✓ | List tasks (filters: `project`, `status`, `limit`). |
| POST | `/tasks` | ✓ | Create a task. Body: `{ title, complexity, description?, project?, tags? }`. |
| GET | `/tasks/:id` | ✓ | Fetch a single task. |
| PATCH | `/tasks/:id/status` | ✓ | Update status (`pending | in_progress | hitl_wait | done | cancelled`). |
| POST | `/tasks/:id/steps` | ✓ | Append an AI step with prompt/response/cost/latency. |
| POST | `/tasks/:id/hitl-approve` | ✓ | Record a human approval for a HITL-gated task. |

### `/audit` — append-only ledger

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| POST | `/audit` | ✓ | Append an audit event. |
| GET | `/audit?n=N` | ✓ | Last N events (default 20, max 200). |
| GET | `/audit/integrity-check` | ✓ | Recompute hash chain; returns `{ valid, total, broken }`. |

### `/knowledge` — 4-layer store

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| GET | `/knowledge` | ✓ | List items (filter by `layer`, `project`). |
| POST | `/knowledge` | ✓ | Create a knowledge item in a specific layer. |
| POST | `/knowledge/search` | ✓ | FTS5 search. Body: `{ query, limit?, project? }`. |
| POST | `/knowledge/:id/promote` | ✓ | Promote a candidate to the incident layer (atomic w/ audit). |

### `/playbooks`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| GET | `/playbooks` | ✓ | List playbooks. |
| POST | `/playbooks` | ✓ | Create a playbook. |
| GET | `/playbooks/slug/:slug` | ✓ | Lookup by slug. |
| GET | `/playbooks/:id` | ✓ | Lookup by id. |
| PATCH | `/playbooks/:id` | ✓ | Update content/metadata. |

### `/incidents`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| GET | `/incidents` | ✓ | List incidents. |
| POST | `/incidents` | ✓ | Report an incident. |
| GET | `/incidents/patterns` | ✓ | List candidate patterns eligible for promotion. |
| POST | `/incidents/patterns/:hash/approve` | ✓ | Approve a candidate pattern. |

### `/policies`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| GET | `/policies` | ✓ | List all policies. |
| POST | `/policies` | ✓ | Create a standard or budget policy (discriminated on `policyKind`). |
| POST | `/policies/evaluate` | ✓ | Evaluate a proposed `{ toolName, actionType, resource }` against active standard policies. |
| POST | `/policies/:id/activate` | ✓ | Activate. |
| POST | `/policies/:id/deactivate` | ✓ | Deactivate. |

### `/traces`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| POST | `/traces` | ✓ | Record a trace row (tokens, cost, latency, model). |
| GET | `/traces/summary?period=P` | ✓ | Aggregate over `P ∈ {1h, 24h, 7d, 30d, mtd}`. |

### `/budget`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| POST | `/budget/check` | ✓ | Advisory budget status for `{ toolName?, resource? }`. See the 7-state table above. |

### `/verifications`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| POST | `/verifications` | ✓ | Record a verification outcome for a step. |

### `/hitl`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| POST | `/hitl/evaluate` | ✓ | Evaluate an action context against all four HITL axes; returns triggers. |

### `/preflight`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| POST | `/preflight` | ✓ | One-shot diagnostic combining policy + HITL evaluation without side effects. |

**Total**: 34 endpoints (1 health + 33 authenticated).

---

## MCP tools reference

17 tools mapped 1:1 to the REST surface. Naming rule: `get_/list_/search_/tail_/verify_/check_` = READ, all others WRITE. All tools re-validate server-side inside atomic transactions — `preflight_check` and `check_budget` results are advisory.

### READ (9)

| Tool | Backing route | Purpose |
|------|---------------|---------|
| `list_tasks` | `GET /tasks` | List tracked tasks. |
| `get_task` | `GET /tasks/:id` | Fetch one task. |
| `tail_audit` | `GET /audit?n=N` | Last N audit events. |
| `verify_audit_integrity` | `GET /audit/integrity-check` | Report broken hash links. |
| `search_knowledge` | `POST /knowledge/search` | FTS5 search. |
| `get_playbook` | `GET /playbooks/:id` or `…/slug/:slug` | One playbook by id or slug. |
| `get_cost_summary` | `GET /traces/summary` | Aggregate cost + latency. |
| `check_budget` | `POST /budget/check` | Advisory budget status (7 states). |
| `preflight_check` | `POST /preflight` | Policy + HITL diagnostic. |

### WRITE (8)

| Tool | Backing route | Purpose |
|------|---------------|---------|
| `create_task` | `POST /tasks` | Create a task. |
| `update_task_status` | `PATCH /tasks/:id/status` | Transition state. |
| `add_task_step` | `POST /tasks/:id/steps` | Record an AI step. |
| `approve_hitl` | `POST /tasks/:id/hitl-approve` | Human approval. |
| `append_audit` | `POST /audit` | Write an audit event. |
| `create_knowledge` | `POST /knowledge` | Add a knowledge item. |
| `promote_knowledge` | `POST /knowledge/:id/promote` | Candidate → incident. |
| `report_incident` | `POST /incidents` | File an incident. |

Excluded from v0.1 (available via REST only): playbook CRUD beyond GET, incident pattern promotion, raw policy CRUD, `POST /traces`, `POST /verifications`. Rationale: these are curation surfaces, not routine agent actions.

---

## Security model

- **Fail-closed startup** — server exits with code 1 if `AGENTGUARD_TOKEN` is absent. No default token, no dev bypass.
- **Local-only binding** — `HOST = '127.0.0.1'` in `server.ts`. Not a configuration knob.
- **Two-token separation** — `AGENTGUARD_TOKEN` (REST) and `AGENTGUARD_MCP_TOKEN` (MCP HTTP) are independent, so an MCP-layer leak does not grant direct REST access.
- **SHA-256 hash chain** — `content_hash = sha256(original_hash + canonical(event))`; `chain_hash = sha256(prev_chain_hash + content_hash)`. Canonical JSON uses recursive key sorting (see `packages/core/src/audit/chain.ts:5-19`); **not RFC 8785 JCS** — no number or Unicode normalization. Reproducible for same logical JSON with key-order differences, including nested objects; does NOT canonicalize `1.0` vs `1` or NFC/NFD Unicode forms.
- **Redaction-independent integrity** — `original_hash` is frozen at insert; chain verification uses it. `payload` can be blanked for compliance without breaking the chain.
- **Append-only** — no DELETE or UPDATE on `audit_events` anywhere in the codebase.
- **Single connection + WAL** — node:sqlite with `journal_mode=WAL`; the `beginAudit*` / `commit` helpers use atomic transactions for promote/HITL-approve flows.
- **Schema chain preflight** — the server refuses to start if `schema_migrations` does not list every migration in the expected order (`001_initial → 002_original_hash → 003_original_hash_type → 004_cost_budget → 005_policy_eval_index`).

---

## OWASP ASI mapping

OWASP's Agentic Security Initiative top-10 mapped to this codebase. Compliance here is **scoped to a solo-developer local instance** — ASI coverage is partial and listed as a design target, not a certification.

### Verification status summary

Each ASI claim below carries a verification label so readers know which claims are test-asserted and which are design intent.

| Item | Status | Notes |
|------|:------:|-------|
| ASI01 Prompt Injection | `[passed]` | HITL gate enforced (`hitl-enforcement.test.ts`) + policy engine `deny` effect |
| ASI02 Insecure Output Handling | `[passed]` | SHA-256 audit chain, `audit-chain.test.ts`, `chain.test.ts` |
| ASI03 Training Data Poisoning | `[out of scope]` | Upstream model hygiene is the provider's responsibility |
| ASI04 Model DoS | `[pending E2E]` | rate_limit advisory check + budget advisory status — **no end-to-end blocking test** (deferred to v0.3+) |
| ASI05 Supply Chain | `[passed: scoped]` | `pnpm-lock.yaml` pinned + Dependabot grouping introduced in v0.1.4 (runtime/tooling/major-updates separated, security PRs ungrouped); automated SBOM and provenance gates deferred to v0.3+ |
| ASI06 Sensitive Info Disclosure | `[passed: scoped]` | `redactPayload` + `original_hash`-based chain verification — **scoped: 4 key patterns only** (sk-, sk-ant-, Bearer, ghp_); other-vendor keys + PII are operator-handled |
| ASI07 Insecure Plugin Design | `[passed]` | Two independent tokens (REST + MCP) — `middleware/auth.ts`, `transports.ts` |
| ASI08 Excessive Agency | `[passed]` (v0.1.1) | `hitl-enforcement.test.ts`, `task-atomicity.test.ts` — **was documented but not enforced in v0.1.0** |
| ASI09 Overreliance | `[passed]` | `preflight_check` and `check_budget` return advisory-only results; unit tests cover each path |
| ASI10 Model Theft | `[out of scope]` | Model weights not stored; prompt/response storage threat model is host physical access |

**Label legend**:
- `[passed]` — an automated test in this repository asserts the claim in full.
- `[passed: scoped]` — an automated test asserts the claim within a documented scope; broader coverage is the operator's responsibility.
- `[pending E2E]` — unit tests exist but end-to-end integration that exercises the claim is on the v0.2 roadmap.
- `[unverified]` — no test currently asserts the specific claim; consumers should verify independently.
- `[out of scope]` — explicitly not addressed by this tool; listed for ASI coverage completeness.

### ASI01 — Prompt Injection

**Countermeasure**: HITL gate + policy engine. Prompt-injection attempts that would escalate into irreversible actions are caught by the `irreversibility` and `blast_radius` axes before the step transitions out of `hitl_wait`.
**Modules**: `packages/core/src/hitl/gate.ts`, `packages/core/src/policy/engine.ts`

### ASI02 — Insecure Output Handling

**Countermeasure**: every audit event is content-addressable — downstream systems can verify that the output they saw was the output that was approved.
**Modules**: `packages/core/src/audit/service.ts`, `packages/core/src/audit/chain.ts`

### ASI03 — Training Data Poisoning

**Scope**: out of scope for gijun-ai. We do not host or fine-tune models; upstream model hygiene is the provider's responsibility. We do, however, record the model/provider per trace so poisoning patterns can be spotted across sessions.
**Modules**: `packages/core/src/tracer/service.ts`

### ASI04 — Model Denial of Service

**Countermeasure**: advisory rate-limit check in `evaluate()` (1-min window count — see `packages/core/src/policy/engine.ts:157-168`) + advisory cost budget. **Consumer enforces actual request blocking** — the server does not return HTTP 429 automatically; callers read `PolicyResult = 'rate_limited'` and decide. DoS by runaway token cost is detected at `warning → critical → over_budget` and surfaces in the audit log automatically.
**Modules**: `packages/core/src/policy/engine.ts`, `packages/core/src/tracer/service.ts`

### ASI05 — Supply Chain Vulnerabilities

**Scope**: partial. We pin `pnpm-lock.yaml` and avoid unpinned peer dependencies. No automated SBOM yet.
**Modules**: `pnpm-lock.yaml`

### ASI06 — Sensitive Information Disclosure

**Countermeasure**: redaction via `payload` blank + `original_hash` preservation. Subject-access-rights requests can blank PII without breaking the audit chain.
**Scope (honest)**: `redactPayload` matches **4 patterns** at the time of writing: `sk-…`, `sk-ant-…`, `Bearer …`, `ghp_…` (see `audit/service.ts:7-12`). It does **not** match AWS access keys (`AKIA…`), GCP API keys, Stripe `sk_live_…`, Slack tokens (`xoxb-…`), JWTs, OpenAI Project keys, or PII (emails, phone numbers, KR resident IDs). Externalising the pattern set is partially complete: v0.2.0 introduced [`docs/audit-event-schema.md`](./docs/audit-event-schema.md) (SSOT for the `audit_events` table shape, hash-chain semantics, and redaction contract) and `pnpm sync:readme` (regenerator that pins the pattern table below to `packages/core/src/audit/service.ts`). Adding `audit_events.redaction_policy_hash` so audit reproducibility survives policy changes is deferred to v0.3+. Until then, broader redaction is the operator's responsibility — see [`docs/legal.md`](./docs/legal.md).
**Modules**: `packages/core/src/audit/service.ts` (`redactPayload`)

**Pattern table (kept in sync with code via `pnpm sync:readme`):**

<!-- generated:asi06-patterns:start -->

<!-- DO NOT EDIT — generated by `pnpm sync:readme` from packages/core/src/audit/service.ts -->

| # | Regex source | Note |
|---|--------------|------|
| 1 | `/sk-[A-Za-z0-9_-]{20,}/` | — |
| 2 | `/sk-ant-[A-Za-z0-9_-]{20,}/` | — |
| 3 | `/Bearer\s+[A-Za-z0-9._-]{20,}/` | — |
| 4 | `/ghp_[A-Za-z0-9]{36}/` | GitHub personal access tokens |

<!-- generated:asi06-patterns:end -->

### ASI07 — Insecure Plugin Design

**Countermeasure**: MCP uses a separate token from the REST API. A compromised MCP client cannot directly hit the REST layer with elevated rights — it must go through MCP tools that re-validate server-side.
**Modules**: `packages/mcp-server/src/transports.ts`, `packages/server/src/middleware/auth.ts`

### ASI08 — Excessive Agency

**Countermeasure**: four HITL axes + policy `deny` effect + fail-closed auth. The agent can propose anything; irreversible execution requires a human-approval audit event that cannot be forged (chain verification catches tampered approvals).
**Modules**: `packages/core/src/hitl/gate.ts`, `packages/core/src/policy/engine.ts`

### ASI09 — Overreliance

**Countermeasure**: `preflight_check` and `check_budget` explicitly return advisory-only results. The caller must decide. Every abnormal decision path is auto-audited, providing retrospective data on how often human judgment agreed with the advisory layer.
**Modules**: `packages/server/src/routes/preflight.ts`, `packages/core/src/tracer/service.ts`

### ASI10 — Model Theft

**Scope**: out of scope. We do not store model weights. We do store prompts/responses per step in a local SQLite file whose threat model is physical access to the host.

---

## Known limitations

v0.2 is an alpha for **solo developers running a single local instance**. Things that are explicitly deferred:

- **Single-instance only** — SQLite with WAL handles one process safely; team mode is out of scope (fork required, see below).
- **Advisory-only budget** — `checkBudget()` never halts execution. If you need a hard cap, your caller must read the status and stop.
- **No distributed audit** — hash chain is a single file, not replicated.
- **No auth provider integration** — one `AGENTGUARD_TOKEN` per server, rotated by hand.
- **Partial MCP coverage** — 17 tools cover the common-path agent actions; raw policy management, playbook CRUD, incident pattern promotion, and `POST /traces` / `POST /verifications` are REST-only in v0.1.
- **Windows untested** — all dev on macOS Darwin 25.x; Linux expected to work.
- **No UI** — everything is REST + MCP. A `packages/web` slot exists but is empty.

These are honest scope calls, not oversights. They will move out of this list one by one.

---

## Roadmap

Level-based public status framework and the L2 "reference-only public" Definition of Done checklist are in [`docs/public-status-dod.md`](./docs/public-status-dod.md). See [`docs/adoption-scenarios.md`](./docs/adoption-scenarios.md) for a by-scenario fit matrix (✓ personal learning / ✗ team adoption / etc.).

### v0.2.0 (released 2026-04-26)

DA-chain–driven hardening across two patches (v0.1.4 + v0.2.0). No product behaviour changes; no DB migrations. Test count grew from 12 to 78.

- **Lint** — Biome 2.4.13 with a small wrapper at `scripts/lint.mjs` (workaround for a pnpm 10 + macOS bin shim issue) (v0.1.4)
- **CI** — minimal GitHub Actions workflow (`.github/workflows/ci.yml`) with build + test + typecheck + lint on push/PR; `Verify audit-event-schema SSOT` step on ubuntu (v0.1.4 + v0.2.0)
- **Release gate** — `.github/workflows/release.yml` 4-stage gate (versioning regex / changelog / CI workflow_call / build artifact) triggered by `v*` tag push (v0.1.4)
- **Branch + tag protection** — main branch protection ruleset + tag protection ruleset for `v*` (v0.1.4)
- **Dependabot grouping** — runtime / tooling / major-updates 3 groups, security PRs ungrouped (v0.1.4)
- **ASI06 SSOT** — `docs/audit-event-schema.md` (canonical schema for `audit_events` columns + hash chain semantics + redaction contract) + `scripts/verify-audit-schema.mjs` CI gate (v0.2.0)
- **README sync** — `pnpm sync:readme` regenerates the ASI06 pattern table from `packages/core/src/audit/service.ts` (v0.1.4)
- **Proportionality thresholds** — external SSOT pointer at `docs/proportionality-thresholds.md` referencing `~/.claude/da-tools/thresholds.json` (v0.1.4)
- **Contract tests** — `tools-registry` (17 MCP tools, prefix-policy classification) + `tools-zod-negative` (per-tool invalid-input matrix) (v0.2.0)
- **WRITE failure matrix** — 8 scenarios covering `appendAuditEvent` contract: zod throw / valid insert / default payload / 10KB payload / 3-event chain / redaction-vs-originalHash separation / mid-stream throw recovery / fail-fast on missing `audit_events` table (v0.2.0)
- **Audit-tampering tests** — 3 detection cases (prev_hash mutation, middle-row deletion, chain_hash mutation) verified by `verifyChain()` (v0.2.0)
- **Deferred RFC memo** — `docs/v0.2-deferred-rfc-evaluation.md` records cost/benefit/trigger for H6/M3/M5 (self-check automation review, RFC template, gate matrix doc) so reopening the work has a receipt (v0.2.0)

### v0.3+ (deferred / event-triggered)

The following items have explicit reopening triggers — they will move forward when the trigger fires, not on a date.

- **Zod 4 migration** (split RFC: validation / execution / migration / rollback) — triggered by zod 3 EOL or v0.3.0 RFC approval. PR #6 (zod 3.25 → 4.3) was closed after a Tier 1 architecture DA chain found audit-chain hash-equality risk and `z.record` schema breaking; see PR #6 close comment for the full reasoning.
- **TypeScript 7.0 direct migration** — triggered by TS 7.0 RC release (skip the 6.0 transition release). PR #4 (typescript 5.9 → 6.0) was closed after a Tier 1 DA chain found tsup 8.5.1 + TS 6.0 DTS-build incompatibility on macOS via the `baseUrl` deprecation→error path.
- **`audit_events.redaction_policy_hash`** so audit reproducibility survives redaction-policy changes (ASI06 long-tail).
- **Provenance / SBOM publish gate** (RFC 0002) — required before npm publish; release.yml has stub stages for it.
- **Publish-approval gate** (release.yml stages 5–6, currently stubbed).
- **ASI04 end-to-end DoS blocking test** (currently `[pending E2E]`).
- **`packages/web`** read-only dashboard (Vite + shadcn/ui) — slot exists but empty.
- **Playbook CRUD in MCP** / **Incident pattern promotion via MCP** / **`POST /policies/:id` PATCH for edit-in-place**.
- **JSONL export of audit log** for external retention.
- **Plugin API** for custom HITL axes.
- **LangChain / Mastra / other-framework adapters**.
- **Continuous integration of OWASP ASI checks**.

### Out of scope (fork required)

gijun-ai is a single-user tool. The following are **not on the roadmap** — if you need them, fork the project:

- Multi-instance mode with leader-elected audit replication
- Team mode with per-user tokens and RBAC
- SaaS / cloud hosting
- Organization-level billing

### Not on the roadmap

Cloud-hosted SaaS, organization-level billing, model hosting, collaborative editing. If any of these sound important, gijun-ai is probably not the tool — it's built for a single developer at a single keyboard.

---

## Development

Contributions are scoped across five axes — Branding (A) / Reliability (B) / Authority (C) / Operations (D) / Legal (E). See [`docs/project-framework.md`](./docs/project-framework.md) for axis boundary rules. A well-scoped PR touches one axis. Legal/license/PII considerations live in [`docs/legal.md`](./docs/legal.md). Contribution workflow: see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

### Layout

```
gijun-ai/
  migrations/                SQL migrations (numbered, order-critical)
  packages/
    core/                    @gijun-ai/core — domain modules, no HTTP
    server/                  Express REST API
    mcp-server/              MCP server (STDIO + Streamable HTTP)
    web/                     (reserved, empty in v0.1)
  pnpm-workspace.yaml
  tsconfig.base.json
```

### Build + test

```bash
pnpm install
pnpm build                   # builds all three packages (tsup for core, tsc for server/mcp-server)
pnpm test                    # runs all package tests across core/server/mcp-server (node --test)
pnpm lint                    # Biome lint via scripts/lint.mjs wrapper
pnpm sync:readme:check       # verifies the ASI06 pattern table is in sync with code
pnpm verify:audit-schema     # verifies docs/audit-event-schema.md against migrations/*.sql
```

### Verify the audit chain of an existing DB

```bash
AGENTGUARD_DB_PATH="./gijun.db" pnpm audit:verify
# → { valid: true, total: 42, broken: [] }
```

### Initialize a fresh DB

```bash
AGENTGUARD_DB_PATH="./gijun.db" pnpm init
```

### Contributing

This is a personal project. Issues and PRs are welcome but not guaranteed a response. If you want to ship something real on top of it, fork it — the architecture is meant to be legible in one sitting.

---

## License

MIT — see [`LICENSE`](./LICENSE).
