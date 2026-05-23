# Credential Sanitization Guide

> **Status**: Active (CSR #780 Phase 3, 2026-05-23)
> **Audience**: Operators deploying agentguard-server; engineers extending the server with new logging paths.
> **Source**: CSR #771 4-AI Tier 1 (security) DA carry-forward R2-C3.
> **Related**: `docs/failure-mode-policy.md` §5 (side-channel matrix) and §6 (open items).

## 1. What Is Covered

As of CSR #780, agentguard sanitizes sensitive values (tokens, secrets, API keys) in these surfaces:

| Surface | Module | Status |
|---------|--------|--------|
| `audit_events` DB rows | `packages/core/src/audit/redact.ts` (formerly inline in `service.ts`) | **Active** |
| `console.log/warn/error` output | `packages/core/src/lib/log-sanitizer.ts` | **Active** (CSR #780) |
| Node.js diagnostic reports (`process.report.writeReport()`) | `packages/server/src/lib/crash-report.ts` | **Active** (CSR #780) |

## 2. What Is NOT Covered (Known Limits)

The following surfaces are **not yet sanitized**. Operators must take additional care.

### 2.1 `process.stdout.write` / `process.stderr.write` (direct writes)

The `installLogSanitizer()` wrapper covers `console.log/warn/error`. It does **not** intercept direct writes to `process.stdout` or `process.stderr` from native bindings, third-party C++ add-ons, or `process.stdout.write()` calls.

**Mitigation**: Avoid logging raw token values in code paths that use direct stream writes. If structured logging (pino, winston) is adopted in a future phase, configure a sanitization transform at the transport layer.

### 2.2 `--diagnostic-report-on-uncaught-exception` Node.js flag

When Node.js is launched with `--diagnostic-report-on-uncaught-exception`, the runtime generates a diagnostic report **before** any `uncaughtException` event handlers run. This means `installCrashSanitizer()` cannot intercept that report.

**Mitigation**:
- Do NOT use `--diagnostic-report-on-uncaught-exception` in production deployments.
- If you need automatic crash reports, rely on `installCrashSanitizer()` instead (it registers its own `uncaughtException` handler and calls `process.report.writeReport()` explicitly after sanitizing).
- If the flag must be used (e.g., for a specific debugging session), rotate all tokens immediately afterward.

### 2.3 V8 heap snapshots and `--inspect`

Using `--inspect`, `--inspect-brk`, or any heap snapshot tool (`heapdump`, Chrome DevTools "Memory" panel) exposes the full V8 heap, which includes in-memory token strings.

**Mitigation**:
- Never use `--inspect` in production. Use only in isolated development environments.
- After any debugging session that accessed heap contents, treat all tokens as potentially exposed and rotate them.
- The token is held in memory as a plain string in `token-holder.ts`. A future improvement could use a `SecureBuffer` or OS keyring, but this is not in the current scope.

### 2.4 Child processes and `spawn`/`exec` with env inheritance

If `spawn({ env: process.env })` is used, child processes inherit `AGENTGUARD_TOKEN`. The child's `console` output is not sanitized by the parent's `installLogSanitizer()`.

**Mitigation**: Pass only the environment variables the child actually needs (use an explicit `env` object rather than inheriting all of `process.env`).

## 3. Sanitization Patterns

Both `installLogSanitizer()` and `sanitizeCrashReport()` use the same redaction logic from `packages/core/src/audit/redact.ts`:

### Value-pattern regex (8 patterns)
Matches known API-key and token formats in string values:
- OpenAI `sk-…`
- Anthropic `sk-ant-…`
- `Bearer …` (Authorization header)
- GitHub PAT `ghp_…`
- AWS Access Key ID (`AKIA…` / `ASIA…`)
- AWS Secret Access Key (keyword context)
- GCP PEM block header
- Azure Storage Account Key

### Key-name pattern
Any object key matching `/(^|_)(token|secret|password|api[_-]?key|authorization|cookie|session[_-]?id|refresh[_-]?token|access[_-]?token)$/i` has its value replaced with `[REDACTED]` regardless of the value's format.

### Idempotency
A value already containing `[REDACTED]` is not modified further on a second pass.

## 4. Operator Checklist

Before deploying to production:

- [ ] **Do not use `--diagnostic-report-on-uncaught-exception`** in the process arguments or `ecosystem.config.js`.
- [ ] **Do not use `--inspect` or `--inspect-brk`** in production; remove from `npm run dev` scripts before building the production image.
- [ ] **Avoid `spawn({ env: process.env })`** unless the child process needs the token.
- [ ] **After any debugging session** that involved heap inspection or verbose log capture, rotate `AGENTGUARD_TOKEN` and `AGENTGUARD_MCP_TOKEN`.
- [ ] **Verify log sanitizer is active**: look for `[agentguard] log sanitizer installed` in startup logs. If absent, check `AGENTGUARD_LOG_SANITIZE` env.

## 5. Opt-Out

| Feature | Env var | Default | Notes |
|---------|---------|---------|-------|
| Log sanitizer | `AGENTGUARD_LOG_SANITIZE=0` | **on** | Tier-B graceful-degrade. A `console.warn` is emitted at boot. |
| Crash-report sanitizer | `AGENTGUARD_CRASH_REPORT_SANITIZE=0` | **on** | Tier-B graceful-degrade. A `console.warn` is emitted at boot. |

## 6. Future Work (carry-forward)

The following improvements are tracked but out of scope for this PR:

- **Structured logging (pino/winston)**: a transport-level sanitize transform would cover direct stream writes and child process output.
- **SecureBuffer / OS keyring**: move in-memory token from plain `string` to a protected memory region.
- **`AGENTGUARD_TOKEN` env scrub**: remove from `process.env` after capture so that `spawn` inheritance is less dangerous.
