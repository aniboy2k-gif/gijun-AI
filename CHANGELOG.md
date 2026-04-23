# Changelog

All notable changes to `gijun-ai` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), semver.

## [0.1.1] — 2026-04-23

### Context

Phase F code review (mQMS framework) surfaced 3 Critical + 8 High issues
against the v0.1.0 release. Phase G implements all 11 fixes across four
atomic topic commits. Design validated through a Tier 2 DA chain
(Gemini → ChatGPT → Claude Web) which contributed 3 additional Critical
items (NC1–NC3) and 4 High items (NH1–NH4) that are all included below.

### Added

- **`@gijun-ai/core/lib/tx.ts`** — `withTxAndAudit<T>(fn)` wraps state
  change + audit insert in a single `BEGIN IMMEDIATE` transaction with
  audit-first rollback policy. Used by `createTask`, `updateTaskStatus`,
  `approveHitl` (BC1).
- **`@gijun-ai/core/lib/error-codes.ts`** — `ErrorCode` enum and
  `CodedError` class. Replaces `Object.assign(new Error, { code })`
  pattern across core services.
- **`@gijun-ai/core/lib/error-mask.ts`** — `toPublicFieldErrors(zodError)`
  collapses internal field names (`_`, `__`, `internal_`, `hitl_`,
  `audit_` prefixes) to `invalid_field` before serialization (NH2,
  CWE-209).
- **`@gijun-ai/core/lib/limits.ts`** — `LIST_MAX_LIMIT=500`,
  `POLICY_EVAL_SAFE_CAP=501`, `HITL_RULE_VERSION=1` constants.
- **`@gijun-ai/core/lib/paths.ts`** — `PACKAGE_ROOT`, `MIGRATIONS_DIR`
  single source of truth (NH1), CJS/ESM safe.
- **`@gijun-ai/core/lib/crypto-compare.ts`** — `safeTokenCompare()`
  timing-safe token comparison with dummy-buffer branch on length
  mismatch (H2, NM3).
- **`@gijun-ai/core/hitl/gate.ts` → `evaluateHitlForTask()`** — task-level
  HITL evaluation with versioned trigger metadata
  (`ruleVersion`/`evaluator`/`evaluatedAt`/`axes`/`inputs`/`mode`).
- **`migrations/005_policy_eval_index.sql`** — composite index
  `idx_policies_eval (policy_kind, tool_name, action_type, is_active)`
  + `hitl_trigger_immutable` BEFORE UPDATE trigger (NH4).
- **New regression tests** (16): hitl-enforcement, task-atomicity,
  hitl-incomplete-context, migrations-chain, policy-overflow,
  hitl-trigger-immutable, error-mask, list-limit. Core now ships
  30/30 passing.

### Changed

- **C1**: `createTask` now evaluates HITL triggers automatically;
  `updateTaskStatus` rejects `done` transitions when
  `hitl_required=1 AND hitl_approved_at IS NULL` with HTTP 409.
  README's ASI08 claim is now true in code.
- **BC1**: `createTask`, `updateTaskStatus`, `approveHitl` are atomic
  state+audit writes via `withTxAndAudit`.
- **QC1**: `evaluate()` now uses explicit columns, composite index,
  `LIMIT 501`, and a count-based pre-check. Reaching the cap raises
  `POLICY_OVERFLOW` (fail-closed) rather than silently truncating.
- **H1/BH3**: `errorHandler` maps `CodedError.code` to HTTP status
  (NOT_FOUND→404, CONFLICT→409, HITL_REQUIRED→409, POLICY_OVERFLOW→500,
  VALIDATION→400). Unknown errors surface as 500 with `requestId` and
  masked message. Core services throw `CodedError` instead of
  `Object.assign`'d errors.
- **BH1/BH2/QH4**: every write/PATCH/GET list route now Zod-validates
  `req.body` / `req.query` (incidents, tasks incl. steps, knowledge,
  playbooks incl. PATCH, traces, policies incl. evaluate, preflight,
  hitl).
- **QH1**: list services (playbook, knowledge, incident, policy) accept
  a `limit` parameter clamped to `LIST_MAX_LIMIT=500`. Routes validate
  via Zod.
- **QH2**: playbook slug path constrained to `/^[a-z0-9-]{1,64}$/`.
- **QH3**: trace `traceId` (when provided) constrained to
  `/^[a-fA-F0-9-]{1,64}$/`.
- **H2**: `middleware/auth.ts` and `mcp-server/transports.ts` use
  `safeTokenCompare()` from `@gijun-ai/core`. Length check is constant-
  time (dummy buffer comparison on mismatch).
- **L1**: `packages/core/src/cli/init.ts` → `init.mts` (explicit ESM),
  resolving `tsc --noEmit` TS1470. `package.json init` script updated.
  Core now passes `tsc --noEmit` with 0 errors.

### Security

- ASI08 HITL gate contract is now enforced in code. v0.1.0 documented
  the gate but did not implement it.
- CWE-209 — validation responses no longer leak internal schema field
  names to external callers.
- CWE-208 — token comparison is constant-time on both the REST and MCP
  paths.

### Breaking (opt-in via env var)

- **`GIJUN_HITL_STRICT_MODE`** (default `0` in v0.1.1): when set to `1`,
  `complex`-complexity tasks created without `toolName`/`actionType`/
  `resource` context escalate to `hitl_required=1` with an
  `incomplete_context` axis. v0.1.2 will flip the default to `1`. This
  is a fail-closed direction — prepare by attaching the context fields
  at `createTask` time.
- `critical`-complexity tasks always set `hitl_required=1` regardless of
  this variable.

### Migration

- A new `schema_migrations` row for `005_policy_eval_index` is required
  before server startup. `runMigrations()` applies it automatically.
  Operators who pin `AGENTGUARD_MIGRATIONS_PATH` must ensure the file is
  reachable.
- Core's `listKnowledge`, `listPlaybooks`, `listPolicies`,
  `listCandidatePatterns`, `listIncidents` signatures changed from
  positional `(scope?: string)` / boolean to `opts: { ..., limit? }`.
  External callers using the core library directly must migrate;
  REST/MCP surface is unchanged.

### Deferred to v0.2 (documented during Phase G DA chain)

- Stale approval re-evaluation (task-context drift invalidates approval)
- Domain exception classes (NotFoundError, ConflictError, …)
- REST/MCP canonical schema (single source of input contracts)
- Legacy v0.1.0 cohort backfill script
- Branded-type domain IDs
- RFC 7807 Problem Details
- Full-scope TransactionManager abstraction
- `@gijun-ai/common-security` package split
- Offset/cursor pagination on list endpoints
- Vendor trace ID / slug format expansion

## [0.1.0] — 2026-04-23

- Initial public release. REST API across 8 core modules, 17 MCP tools
  (STDIO + Streamable HTTP), advisory cost budget, bilingual README.
  See commits `324571f`, `1695c99`, `498e344`, `5aa47b8`.
