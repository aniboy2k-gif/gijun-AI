# Changelog

All notable changes to `gijun-ai` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), semver.

## [0.1.2] — 2026-04-23

### Context

Post-v0.1.1 public-value review. A Tier 2 codex-da-chain review (Gemini →
ChatGPT → Claude Web, `architecture` role) found that v0.1.1's README
contained overclaim (`governance platform/layer`), version drift (badge
and `/health` example frozen at 0.1.0), unverifiable claims (canonical
JSON, rate-limit enforcement), and no mechanism to prevent future
claim-to-code drift. This release addresses the four DA blockers and the
four improvement items, moving the repository toward L2 "reference-only
public" status (see `docs/public-status-dod.md` for the full DoD).

**No product code changes to the audit/HITL/policy engines** — this is
honesty, CI, and documentation work built on top of the v0.1.1 gate. The
only source change is `app.ts` reading version dynamically from root
`package.json` to prevent future `/health` version drift.

### Added

- **`.github/workflows/claim-check.yml`** + **`.github/claim-map.yml`** —
  CI job that fails the build if README references an `ASI##` claim or
  `Architecture contract` without the backing test/source file declared
  in the mapping. Prevents the v0.1.0-style drift where ASI08 was
  documented but not enforced.
- **`.github/workflows/ci.yml`** — build + test matrix on
  `ubuntu-latest` + `macos-latest`, Node 22.
- **`.github/workflows/codeql.yml`** — JavaScript/TypeScript security
  scan on push/PR and weekly schedule.
- **`.github/dependabot.yml`** — weekly npm + github-actions update PRs.
- **`.github/pull_request_template.md`** — ASI/contract claim gate + test
  checklist + single-user scope reminder.
- **`.github/ISSUE_TEMPLATE/bug_report.yml`** and **`feature_request.yml`**
  — guided issue intake with scope-check questions.
- **`docs/public-status-dod.md`** — L1→L2→L3 level framework with
  measurable Definition of Done checklists. L4 (production-dependency-
  safe) is explicitly out of scope.
- **`docs/project-framework.md`** — 5-axis (A/B/C/D/E) scoping framework
  with boundary rules. Replaces the implicit 4-axis grouping the initial
  DA review showed was not MECE.
- **`docs/adoption-scenarios.md`** — by-scenario fit matrix (personal
  learning ✓ / team adoption ✗ / production dependency ✗).
- **`docs/legal.md`** — Axis-E concerns: MIT license semantics, fork
  propagation, PII/GDPR redaction path, MCP spec dependency, model-
  provider ToS monitoring.
- **`CONTRIBUTING.md`** — PR workflow, single-axis scoping, claim-gate
  requirements, out-of-scope list (multi-user, RBAC, SaaS).
- **`packages/server/src/__tests__/`** (new directory) with 8 E2E tests:
  - `health.e2e.test.ts` — `/health` returns root `package.json` version
  - `rest-hitl-flow.e2e.test.ts` — critical task → 409 → approve → 200;
    trivial task free transition; fail-closed 401 without token
  - `rest-audit-chain.e2e.test.ts` — 3 appends + integrity-check valid;
    tail ordering

### Changed

- **`README.md`** / **`README.ko.md`**:
  - Tagline "personal AI-agent governance platform" → "personal single-
    user audit/verification workbench". "governance platform/layer"
    language removed throughout. "governance" retained only in the
    narrow ASI08 naming context.
  - Status line added at top: "Status: personal single-user tool — not
    a production dependency. The HITL gate is a self-approval
    speed-bump, not multi-party governance. Fork the project if you
    need team mode, RBAC, or multi-user separation-of-duties."
  - HITL module narrative reframed as self-approval speed-bump.
  - Canonical JSON claim honesty: reproducibility is for recursive key
    sorting only — **not RFC 8785 JCS**, no number or Unicode
    normalization. Implementation path cited
    (`audit/chain.ts:5-19`).
  - Rate-limit claim honesty: advisory check in `evaluate()` (1-min
    window); **consumer enforces actual request blocking** — server
    does NOT return HTTP 429 automatically. Implementation paths cited.
  - Roadmap reorganized: v0.3 "Team mode with per-user tokens and
    RBAC" and "Multi-instance replication" moved to **"Out of scope
    (fork required)"** block. v0.3+ only lists long-term nice-to-haves
    that may never ship.
  - Version badge switched to `shields.io/github/package-json/v/...`
    dynamic badge so it tracks `package.json` automatically.
  - `/health` curl example uses `<package.json version>` placeholder.
  - `schema_migrations` chain updated to include `005_policy_eval_index`.
  - Architecture contracts table gains a `Status` column
    (`[passed]` / `[pending E2E]` / `[unverified]`).
  - OWASP ASI mapping section gains a "Verification status summary"
    table with per-ASI label + legend.
  - Roadmap and Development sections link to new `docs/` documents.
- **`packages/server/src/app.ts`**: `/health` reads version dynamically
  from repository-root `package.json` (falling back through candidate
  paths for src/dist layouts). Prevents the v0.1.0 drift where the
  hardcoded string lagged `package.json`.
- **`package.json`** description: "Personal AI Agent Governance
  Workbench" → "Personal single-user AI agent audit/verification
  workbench".
- **`CHANGELOG.md`** v0.1.1 entry gains a **Retroactive honesty note**
  explicitly stating that ASI08 was documented but not enforced in
  v0.1.0 — flagged prominently for readers who might only skim the
  latest release notes.

### Scope decision

- **C-1a single-user confirmed.** gijun-ai is positioned as a personal
  1-user audit workbench. The HITL gate is a self-approval speed-bump.
  Multi-user, RBAC, and team operation are **out of scope** — forks are
  the expected path for those needs. This simplifies the threat model
  (single `AGENTGUARD_TOKEN` is adequate), simplifies E2E test design
  (no cross-user scenarios), and sets clear adopter expectations.

### Migration

- No schema changes. No breaking API changes. Existing v0.1.1 databases
  continue to work unchanged.
- The `/health` endpoint now reports the repository-root
  `package.json` version string dynamically. Consumers that parsed the
  hardcoded `"0.1.0"` string should expect `"0.1.2"` (and future
  versions) to appear.

### Deferred to v0.2 / later

- MCP transport E2E tests (STDIO `child_process.spawn` + JSON-RPC
  round-trip; HTTP auth flow)
- `license-checker` integration for transitive-license audit
- `packages/web` read-only dashboard
- Release Gate concept as a reusable skill — deferred until a second
  repository demonstrates the same pattern (YAGNI).



### Context

**Retroactive honesty note for v0.1.0 readers**: The v0.1.0 README (commit
`5aa47b8`) claimed that ASI08 (Excessive Agency) was addressed by a HITL
gate requiring a human-approval audit event before irreversible execution.
**In v0.1.0 this contract was documented but not enforced in code** —
`evaluateHitl` existed in `hitl/gate.ts` but was never called from
`createTask` or `updateTaskStatus`, and no status-transition guard rejected
`done` without an approval record. Anyone who evaluated v0.1.0 against its
README would have found the claim false. v0.1.1 connects the gate (Phase G
commit `69c3237`); v0.1.2 adds a CI `claim-check` workflow so this class
of drift cannot recur silently.

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
