# Failure-Mode Unified Policy

> **Status**: Active (CSR #777 Phase 1, 2026-05-23)
> **Audience**: Engineers introducing new error-handling code in agentguard-server, mcp-server, or core.
> **Source**: CSR #771 4-AI Tier 1 (security) DA carry-forward (R2-H5).

## 1. Classification

Every failure path falls into exactly one of these three tiers:

| Tier | Name | Behavior on failure | When to use |
|------|------|---------------------|-------------|
| **A** | Security-critical fail-close | Refuse the request / abort boot / `process.exit(1)` / 4xx-5xx with minimal message | Token missing or invalid, audit append-only invariant broken, schema chain mismatch, token timing-compare failure, authentication-decision surfaces (401/503) |
| **B** | Operational graceful-degrade | Emit warning, continue with reduced functionality | Stale temp file sweep failure, non-essential cache miss, optional metric emission failure |
| **C** | Contract / input validation | Return 4xx with explanatory message; **response body changes require separate security review** | Schema/contract violation (400), input type mismatch, bounded enum out-of-range |

### Decision rule

- **If the failure could leak secrets, corrupt integrity, or break authentication** → Tier A.
- **If the failure only degrades a non-essential subsystem** (log sweep, observability, optional cache) → Tier B.
- **If the failure originates from user input violating a documented contract** → Tier C.

When in doubt, choose Tier A. Promoting C→A is cheap; demoting A→B/C requires explicit user approval and a security review.

**Tier C response-body changes are themselves security-sensitive.** Adding hints (`expected length=N`, `valid values: ...`) to 4xx responses can reveal contract internals. Any change to a Tier C response body must be reviewed by a security-engineer agent before merge (CWE-209 surface).

## 2. Current Sentinels (Verified Catalog)

Each row below is mechanically verified by `scripts/verify-failure-mode-consistency.mjs`. The marker form `// fail-mode: <tier-letter> — <description>` is **enforced**: every row must have at least one matching marker in its file. Marker presence is checked at file granularity (line numbers are informational; they may drift between refactors).

| # | Tier | File | Line | Description |
|---|------|------|------|-------------|
| 1 | A | `packages/server/src/server.ts` | 5 | `fail-closed: token must be set before any request can succeed` — `process.exit(1)` if `AGENTGUARD_TOKEN` missing |
| 2 | A | `packages/mcp-server/src/index.ts` | 42 | `fail-closed: HTTP mode requires its own token` |
| 3 | A | `packages/core/src/lib/crypto-compare.ts` | 10 | `constant-time token compare`; `fail-closed` philosophy from README |
| 4 | B | `packages/server/src/server.ts` | 15 | `sweepTmpFiles best-effort`: `continue boot if sweep fails` (warn-and-continue) |
| 5 | B | `packages/server/src/middleware/auth.ts` | 4-9 | `Startup WARNING when AGENTGUARD_TOKEN missing` in middleware load (server.ts already handled Tier A; this duplicate check downgrades to `WARNING`) |
| 6 | A | `packages/server/src/middleware/auth.ts` | 16-19 | `503 Server not configured: AGENTGUARD_TOKEN missing` if `getCurrentToken()` empty at request time (Tier A external surface — fail-close at request time) |
| 7 | A | `packages/server/src/middleware/auth.ts` | 23-26 | `401 Unauthorized: invalid or missing X-AgentGuard-Token` if `isTokenValid` rejects (Tier A external surface — authentication-decision surface) |
| 8 | A | `packages/core/src/hitl/gate.ts` | 124 | HITL `Fail-closed principle`: missing context fields escalate severity rather than weaken the gate |

> Verification: run `node scripts/verify-failure-mode-consistency.mjs` (also wired as `pnpm verify:failure-mode`). The script enforces that each row's file contains at least one `fail-mode: <tier>` marker AND the documented backtick-quoted keywords, and that no `fail-mode:` or legacy `fail-closed` marker exists outside §2.

## 3. Decision Tree

```
New failure path?
│
├── Could it leak secrets, break auth, or corrupt audit chain?
│     └── YES → Tier A (fail-close: abort boot, 4xx/5xx with minimal message, + log + alarm)
│
├── Is it strictly contract/input validation (no auth, no secret, no audit)?
│     └── YES → Tier C (4xx with explanatory message)
│              ⚠ Response body changes require separate security-engineer review
│
└── Is the affected subsystem non-essential to security and core function?
      └── YES → Tier B (warn, continue degraded)
      └── NO  → revisit — likely Tier A
```

When promoting **B → A** or demoting **A → B**, file an entry in CSR with rationale and obtain explicit user approval.

## 4. CWE / STRIDE Mapping

| Tier | Primary CWE | Secondary CWE | STRIDE |
|------|-------------|---------------|--------|
| A | CWE-754 (Improper Check for Unusual Conditions), CWE-755 (Improper Handling of Exceptional Conditions) | CWE-209 (Error Message with Sensitive Info — applies to boot abort & 401/503 bodies), CWE-532 (carry-forward Phase 3) | Tampering, Repudiation, Information Disclosure; **Spoofing → 401 (mitigation)**; **DoS → 503 (degradation surface)** |
| B | CWE-754 | CWE-209 (warning content) | Information Disclosure |
| C | CWE-755 | CWE-20 (Improper Input Validation), CWE-209 (4xx body) | **Spoofing/Tampering mitigation via contract enforcement** |

External compliance reference (informational, full mapping carry-forward):
- **OWASP ASVS v4.0.3**: V7.4.1 (Authentication failure does not reveal sensitive info) → Tier A; V14.2.1 (Verified startup components) → Tier A.
- **NIST SP 800-53 Rev. 5**: SI-11 (Error Handling) → Tier A/B; SC-8 (Transmission Confidentiality) → §5.
- **CIS Controls v8**: 4.7 → token boot check.

## 5. Side-Channel Mitigation Matrix

Auth failure paths are particularly sensitive to **timing side-channels**.

| Mechanism | Where | Default | Status | Override |
|-----------|-------|---------|--------|----------|
| Constant-time token compare | `packages/core/src/lib/crypto-compare.ts` (`safeTokenCompare` using `timingSafeEqual`) | always on | **Implemented** | n/a |
| Artificial latency baseline on 401/503 | `packages/server/src/middleware/auth.ts` (`resolveAuthFailDelayMs` + `jitteredDelay`) | 50ms ± 10% jitter | **Implemented (Phase 2-a, CSR #777)** | env `AGENTGUARD_AUTH_FAIL_DELAY_MS` ∈ [0, 500]; set to 0 to opt out (graceful degrade tier) |

Trade-off:
- **Pro**: Removes observable timing difference between 401 (invalid token) and 503 (server unconfigured), and between fast-reject vs late-reject paths.
- **Con**: Sustained 401 traffic incurs queued delay; a connection-flooding attacker can amplify resource usage. Mitigated by `max=500ms` cap and local-only `HOST=127.0.0.1` (contract #5) which prevents remote exploitation.
- **Tier**: Mechanism itself is Tier A (security-critical). Opting out via env=0 is an explicit Tier-B graceful-degrade decision the operator owns.

## 6. Open Items (carry-forward)

The following hardening items are tracked separately to avoid bloating this PR:
- **R2-M4 latency baseline + restart-jitter helper** — Phase 2 in the same PR; once landed, §5 row 2 status becomes `Implemented` and §6 cluster-mode pointer activates.
- **R2-C3 Credential exfiltration** — **Implemented (CSR #780, 2026-05-23)**: log sanitizer (`packages/core/src/lib/log-sanitizer.ts`), crash-report sanitizer (`packages/server/src/lib/crash-report.ts`), redact helpers extracted to `packages/core/src/audit/redact.ts`, guide `docs/credential-sanitization-guide.md`. Remaining limits (stderr direct, `--diagnostic-report-on-uncaught-exception`, heap snapshot, child process env) documented in the guide.
- **External 4-AI Tier 1 DA re-verification** — after merge (separate session).
- **Cluster mode introduction** — currently boot fail-closes any multi-process topology; if introduced, the `restart-jitter` helper (Phase 2 R2-M4 artifact, dormant until cluster mode is enabled) becomes active.
- **Internal review carry-forward items** (CSR #777 Phase 1 review, 2026-05-23): H1 (line column semantic check), M1 (drift regex extension to UPPER_SNAKE), M3 (CWE mapping deepening), M5 (`packages/web/src/` SCAN_ROOTS inclusion), L1-L5 (descriptions, README coupling, CI integration, public-repo info-disclosure rotation, exclusion list extraction).
- **OSS / multi-tenant rotation** — if this repo becomes public or multi-tenant: rotate §2 file paths into a private appendix to reduce info-disclosure surface (currently LOW for single-user workbench).

## 7. Marker Format (machine-enforced)

To register a new sentinel:

1. Place a comment of this form on or near the failure-handling line:

    ```
    // fail-mode: A — <human description>
    // fail-mode: B — <human description>
    // fail-mode: C — <human description>
    ```

   Block comments inside JSDoc (`* fail-mode: A — ...`) are also recognized.

2. Add a row to §2 with the same Tier letter and backtick-quoted keywords that match a substring of the code (the verify script checks both the marker presence and the keyword substrings).

The verify script grep-scans for `fail-mode: [ABC]` markers in `packages/*/src/` and reconciles with §2. Any `fail-mode:` marker found in a file not registered in §2 is reported as drift (`exit 1`).

**Skip exemptions**: lines tagged `// fail-mode-skip: <reason ≥20 chars>` are exempt. Skip usage is reported in the verify summary (`X skip exemptions`) so reviewers can see it at a glance — **non-zero skip count requires explicit PR acknowledgment**.
