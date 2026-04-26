# Changelog

All notable changes to `gijun-ai` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), semver.

## [0.1.4] — 2026-04-26

### Context

Second DA-chain pass on the v0.1.3 baseline (Tier 1 — Gemini → ChatGPT →
Claude Web → DeepSeek, `architecture` role). The earlier 17-issue patch
shipped with v0.1.3, but a fresh review surfaced 14 follow-up gaps. v0.1.4
addresses **8 of them** (5 HIGH + 3 MEDIUM); the other 6 (the C1 single-
transaction-contract test bundle, H6 self-check automation, M3/M4 RFC
formalisation, M5 gate-matrix doc) are deferred to v0.2 because they
require new test infrastructure that is sized for an RFC, not a patch.

No product behaviour changes. No DB migrations.

### Added

- **Biome** (`@biomejs/biome ^2.4.13`) as the project's lint stop-gap,
  configured to error on real bugs (`noDoubleEquals`, `noUnusedImports`)
  and warn on style drift (`noConsole`, `noExplicitAny`, `noTsIgnore`).
  `biome.json` at the repo root, plus `pnpm lint` / `pnpm lint:fix` via a
  small wrapper at `scripts/lint.mjs` (workaround for a pnpm 10 + macOS
  combination that breaks the bundled bin shim — Linux CI is unaffected,
  see the comment in the wrapper). Closes H1.
- **Branch + tag protection on `main`** (GitHub repository ruleset):
  `allow_force_pushes=false`, `allow_deletions=false`, required status
  checks: `Build & test on Node 22 / ubuntu-latest`, `… / macos-latest`,
  `Verify README claims match code`, `Analyze JavaScript/TypeScript`.
  Tag-protection ruleset (`v*`) blocks deletion / non-fast-forward /
  update on version tags. `enforce_admins=false` so the maintainer can
  still fix CI in an emergency. Closes H2.
- **Typecheck CI step** — `pnpm -r exec tsc --noEmit` plus a separate
  `tsc -p tsconfig.test.json --noEmit` pass for `core` and `server` test
  trees so test-only type errors can no longer hide behind a green
  `pnpm test` (test compilation already typechecks at run time, but now
  the typecheck has its own named step). Closes H3.
- **Release workflow** — `.github/workflows/release.yml` with the four
  immediate gates: versioning (tag regex), changelog (`## [VERSION]`
  header), CI (`workflow_call` to `ci.yml`), build (re-pack mcp-server
  tarball + publish-contract checks). The two escalation gates
  (provenance/SBOM, publish approval) are intentionally absent; they
  land with RFC 0002 when npm publish is enabled. Includes an
  auto-extracted GitHub-release notes step. Closes H4 immediate scope;
  H4 escalation deferred behind `proportionality_thresholds`.
- **ASI06 redaction-boundary test** — `redaction-boundary.test.ts` (7
  cases, all green) covers all 5 boundary paths the README claims:
  input, output (read-back), log (operator pattern), exception (operator
  pattern), audit-event row (full DB round-trip + chain-hash shape).
  Negative-scope assertions pin the README's "scoped: 4 patterns" claim
  by asserting that AWS / Stripe / Slack / JWT / email patterns
  deliberately survive `redactPayload` — if a future patch widens
  coverage without updating the README, this test fails. Closes H5.
- **`pnpm sync:readme` / `:check`** — `scripts/sync-readme.mjs` extracts
  `REDACT_PATTERNS` from `packages/core/src/audit/service.ts` and
  rewrites a `<!-- generated:asi06-patterns -->` block in `README.md`.
  `--check` mode fails CI on drift. Closes M2 (single source of truth).
- **`docs/proportionality-thresholds.md`** — one-page reference to the
  external SSOT (`~/.claude/da-tools/thresholds.json` →
  `proportionality_thresholds`). Closes M4. The numeric thresholds
  themselves live in the maintainer's cross-project SSOT, not in the
  repo, to avoid drift between projects sharing the same "when do I
  escalate?" decision.

### Changed

- **`.github/dependabot.yml`** — split the previous `all-deps` group
  into `runtime` (production deps, minor/patch), `tooling` (dev/build,
  minor/patch), and `major-updates` (any package, major bumps). Security
  updates are intentionally **not** grouped so each lands in its own PR
  for fast review. Closes M1.
- **Workflow permissions** — top-level `permissions: contents: read` on
  `ci.yml` and `claim-check.yml`. The new `release.yml` defaults to
  `contents: read` and elevates only the GitHub-release job to
  `contents: write`. `codeql.yml` already had narrow job-level
  permissions and was left alone. Part of H2.
- **`.npmrc`** — `reporter=append-only` so the lint job's output is
  visible in CI logs (default reporter strips it under non-TTY).
- **`@biomejs/biome`** added to `pnpm.onlyBuiltDependencies` so the
  native binary postinstall actually runs.

### Deferred to v0.2

- **C1 single-transaction-contract test bundle** (5 sub-requirements:
  tool registry contract / zod negative path / WRITE failure matrix
  (8 core scenarios) / audit-chain tampering / audit-event schema SSOT
  + CI drift check). Sized for a dedicated RFC because the failure
  matrix and the audit-event-schema doc both need their own design.
- **H6 self-check automation** — gated on RFC 0003 cost/benefit review.
- **M3 RFC 6-section template** — escalation triggered only at
  `contributor_count ≥ 2` (currently 1).
- **M5 gate-matrix doc** — small but cohabits with the v0.2 RFC index;
  bundled there.
- **C2 publish-epoch tagging + H4 escalation gates (provenance,
  publish approval)** — both fire only when npm publish is enabled
  (RFC 0002). Stubs are present in `release.yml` for orientation.

### Refused (proportionality)

- Auto-redaction of `console.log` and `error.stack` — the operator-
  applied `redactPayload` pattern is asserted by paths 3 and 4 of
  `redaction-boundary.test.ts`; auto-redaction at runtime is a feature
  request, not a bug, and the README is honest about the boundary.
- Fixing the four remaining Biome warnings (`noUnusedVariables` in
  `knowledge/retriever.ts`, `noTsIgnore` + 2× `noNonNullAssertion` in
  `lib/paths.ts`) — surgical-changes principle: those code patterns are
  intentional, the warnings are advisory, and rewriting them belongs in
  a separate PR with its own justification.

### Verified

- `pnpm -r build`: green (core via tsup, server + mcp-server via tsc).
- `pnpm -r test`: 45 / 45 pass (core 37 — 8 new redaction-boundary
  cases on top of v0.1.3's 30; server 8 unchanged).
- `pnpm -r exec tsc --noEmit`: 0 errors.
- `pnpm lint` (Biome): 0 errors, 4 advisory warnings (documented above).
- `pnpm sync:readme:check`: in sync (4 patterns).

## [0.1.3] — 2026-04-26

### Context

DA-chain Tier 1 review (Gemini → ChatGPT → Claude Web, `architecture` role,
DeepSeek skipped due to context pollution) found 17 issues against v0.1.2.
Triage: 1 CRITICAL (publish blocker), 5 HIGH, 5 MEDIUM, 3 LOW, 3 deferred
to v0.2. The Claude Web meta-meta review caught proportionality violations
in the earlier remedies (changesets / claims.yaml registry / immediate
function rename / redaction externalisation) and they were rejected; the
v0.1.3 patch ships only proportional fixes consistent with the
single-user personal-repo identity.

No product behaviour changes. No DB migrations.

### Added

- **`evaluateStepHitl(ctx)` and `evaluateTaskHitl(input, opts?)`** in
  `@gijun-ai/core` — canonical names that disambiguate step-level
  evaluation (5 reasons) from task-level evaluation (4 axes). Both are
  body-equivalent to the previous `evaluateHitl` / `evaluateHitlForTask`,
  which become `@deprecated since v0.1.3` thin wrappers (M1).
- **MCP smoke test in `.github/workflows/ci.yml`** — `pnpm pack` →
  isolated tarball extraction → `dist/index.js` shebang and executable
  bit verification → `bin` field check → `workspace:*` resolution
  check → bin-startup-without-crash. Closes the C1 publish-contract gap
  by making it CI-enforced (C1).
- **`packages/mcp-server/package.json`**: `files: ["dist", "README.md"]`
  + `prepack: tsc && chmod +x dist/index.js` so the publish artifact is
  predictable on every `npm pack` (C1).
- **DoD quarterly drift checklist** (`docs/public-status-dod.md`) — 5
  items the maintainer re-runs per quarter to catch description, README
  Known-Limitations, DoD checkbox, ASI label, and CHANGELOG/`/health`
  drift. Replaces the proposed claims.yaml registry as proportional for
  current claim count (H3, M5).
- **DoD extension thresholds** — quantitative triggers to revisit
  changesets / claims.yaml / ESLint rule / namespace split / redaction
  externalisation when the repo crosses 2+ contributors / 10+ claims /
  3+ external PRs / 3+ MCP clients / first concrete request (M5).

### Changed

- **C1 (publish blocker)** `packages/mcp-server`: `bin` →
  `./dist/index.js` (was `./src/index.ts` which Node cannot execute);
  `src/index.ts` gets a `#!/usr/bin/env node` shebang; `start:stdio`
  now runs `node dist/index.js` and `dev:stdio` keeps the tsx mode.
  `start:http` / `dev:http` split mirrors that.
- **H1 (monorepo version sync)**: workspace versions
  `0.1.0 → 0.1.3` across `core`, `server`, `mcp-server`. Root
  `package.json` `0.1.2 → 0.1.3`. `mcp-server` now reads its own
  `package.json` at startup so the MCP `serverInfo.version` exposed to
  clients tracks the package, not a stale literal. (changesets is NOT
  introduced — see DoD extension thresholds.)
- **H2** `packages/server/src/middleware/auth.ts:13` comment: replaced
  the false claim that GET routes skip the middleware. The actual
  policy ("Required on every protected route. Only `GET /health`
  skips this") matches the README.
- **H3 (drift cleanup)**: workspace `package.json` `description`
  fields now use "audit/verification workbench" wording (was
  "governance platform" — already removed from README in v0.1.2 but
  the workspace metadata had been missed). README Known Limitations
  drops the obsolete "No CI / no GitHub Actions" item (CI was added
  in v0.1.2). DoD line 38 switches from "v0.2 adds this" to
  "added in v0.1.2" with the checkbox checked.
- **H4 (ASI06 claim scope)**: README ASI06 label refines from
  `[passed]` to `[passed: scoped]`, with an enumerated list of the
  4 covered key patterns and the families that are explicitly the
  operator's responsibility (AWS / GCP / Stripe / Slack / JWT / PII).
  New `[passed: scoped]` legend entry added.
- **H5 short-term remedy** Genesis Hash duplication: cross-reference
  comments tie `audit/chain.ts:3` and `migrations/001_initial.sql:136`
  together. Run-time `assertGenesisHash()` and the proposed
  `schema_metadata` table are deferred to v0.2.
- **M2** `packages/mcp-server/src/tools.ts:34` section header count
  `READ tools (8)` → `(9)`. README MCP table was already correct.
- **M3** `audit/service.ts`: extracted private `insertAuditRow` helper
  shared by `insertAuditEventInTx` and `appendAuditEvent`. No
  behaviour change — just removes ~70 lines of duplicated hash-and-
  insert logic.
- **L3** `CHANGELOG.md` v0.1.1 entry: added the missing `## [0.1.1]`
  header (the retroactive honesty note used to read as a stray block
  at the bottom of v0.1.2).

### Deferred to v0.2

- **DEF1 — Redaction externalisation + `redaction_policy_hash`**:
  external `.agentguard/redaction.json` is *not* introduced in
  v0.1.3 because the audit chain has no way to record which policy
  version produced which `payload`. v0.2 will land `migration 006`
  with `audit_events.redaction_policy_hash`, the matching
  `redactPayload(value, policyHash)` overload, and an
  `integrity-check` extension. RFC `docs/rfcs/0001-redaction-policy-
  hash.md` to be drafted before code.
- **DEF2 — Remove deprecated HITL aliases** (`evaluateHitl`,
  `evaluateHitlForTask`).
- **DEF3 — MCP tools namespace split** (`tools/read`, `tools/write`,
  `tools/audit`) — v0.2 if MCP clients reach the threshold.
- **H5 mid-term** — `schema_metadata` table and
  `assertGenesisHash()` runtime check.

### Refused (proportionality)

- `changesets` introduction — appropriate at 2+ contributors only
- `claims.yaml` structured registry + auto-generated README — appropriate
  at 10+ claims only
- `claim-check` natural-language negation parsing (`grep "no CI"`) —
  high false-positive rate, replaced by quarterly checklist in DoD
- ESLint rule / `protectedRouter()` wrapper enforcing `requireToken` —
  appropriate at 3+ external PRs adding routes
- Immediate rename of `evaluateHitl` → `evaluateStepHitl` (no
  deprecation) — would have been a SemVer breaking change for the
  REST `/hitl/evaluate` consumer

### Verified

- `pnpm -r build`: green
- `pnpm -r test`: 38/38 pass (core 30, server 8)
- `pnpm pack -w packages/mcp-server`: tarball contains
  `dist/index.js` (executable, with shebang), workspace deps
  resolved to concrete versions

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

## [0.1.1] — 2026-04-23

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
