# Audit Event Schema (SSOT)

> Single source of truth for the `audit_events` table — column shape, hash chain
> rules, redaction contract. Drift is caught by `pnpm verify:audit-schema`
> (CI gate + local script).

## 1. Table columns

The schema below is the result of applying **all migrations** in `migrations/`
(currently `001_initial.sql` + `002_original_hash.sql` + `003_original_hash_type.sql`).
Any change to these migrations MUST be reflected in the table below — the verify
script will refuse to pass otherwise.

<!-- generated:audit-events-columns:start -->
| cid | name                | type    | notnull | dflt_value                                                        | pk |
|----:|---------------------|---------|--------:|-------------------------------------------------------------------|---:|
| 0   | id                  | INTEGER | 0       |                                                                   | 1  |
| 1   | prev_hash           | TEXT    | 1       | '0000000000000000000000000000000000000000000000000000000000000000'| 0  |
| 2   | content_hash        | TEXT    | 1       |                                                                   | 0  |
| 3   | chain_hash          | TEXT    | 1       |                                                                   | 0  |
| 4   | event_type          | TEXT    | 1       |                                                                   | 0  |
| 5   | actor               | TEXT    | 1       | 'ai'                                                              | 0  |
| 6   | actor_model         | TEXT    | 0       |                                                                   | 0  |
| 7   | task_id             | INTEGER | 0       |                                                                   | 0  |
| 8   | resource_type       | TEXT    | 0       |                                                                   | 0  |
| 9   | resource_id         | TEXT    | 0       |                                                                   | 0  |
| 10  | action              | TEXT    | 1       |                                                                   | 0  |
| 11  | payload             | TEXT    | 1       | '{}'                                                              | 0  |
| 12  | ip_addr             | TEXT    | 0       |                                                                   | 0  |
| 13  | created_at          | TEXT    | 1       | datetime('now')                                                   | 0  |
| 14  | original_hash       | TEXT    | 0       |                                                                   | 0  |
| 15  | original_hash_type  | TEXT    | 0       | 'legacy'                                                          | 0  |
<!-- generated:audit-events-columns:end -->

> The `dflt_value` column shows the *literal* SQL default expression that
> SQLite reports back via `PRAGMA table_info`. Comparison with the source SQL
> is whitespace-normalized.

## 2. Hash chain semantics

```
GENESIS_HASH       = "0" × 64                               (chain sentinel)
contentHash(row)   = SHA256(canonicalJson(eventType, actor, action, payload, createdAt))
                     where payload is post-redaction (stored bytes)
originalHash(row)  = SHA256(canonicalJson(eventType, actor, action, payload, createdAt))
                     where payload is pre-redaction (raw input)
chainHash(row)     = SHA256(prevHash + originalHash(row))
```

- `chain_hash` binds to `original_hash` (pre-redaction) so that **redaction
  policy changes never invalidate the chain**. Only the redacted payload is
  ever persisted.
- The first row has `prev_hash = GENESIS_HASH`. Each subsequent row's
  `prev_hash` MUST equal the previous row's `chain_hash`.
- `original_hash_type` discriminates between rows written before
  migration 002 (`'legacy'` — `original_hash` is a copy of `content_hash`)
  and rows written after (`'redaction_pre'`).

## 3. Redaction contract (ASI06)

The patterns currently masked at storage time, in order of application
(see `packages/core/src/audit/service.ts`):

1. `/sk-[A-Za-z0-9_-]{20,}/g`
2. `/sk-ant-[A-Za-z0-9_-]{20,}/g`
3. `/Bearer\s+[A-Za-z0-9._-]{20,}/gi`
4. `/ghp_[A-Za-z0-9]{36}/g`

All matches collapse to the literal placeholder `[REDACTED]`. Patterns are
intentionally a **scoped allow-list of high-confidence formats**, not a
universal scrubber — see README `## ASI06 (audit-side info)` for the
non-coverage list. The README block is kept in sync with code by
`pnpm sync:readme`.

## 4. Example payloads

### 4a. Pre-redaction input (caller's perspective)

```json
{
  "eventType": "tool.call",
  "actor": "ai",
  "actorModel": "claude-sonnet-4-6",
  "action": "create_knowledge",
  "payload": {
    "title": "auth retry policy",
    "content": "see ticket #482",
    "credentials": {
      "key": "sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "github": "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    }
  }
}
```

### 4b. Persisted payload (post-redaction, what `tail_audit` returns)

```json
{
  "title": "auth retry policy",
  "content": "see ticket #482",
  "credentials": {
    "key": "[REDACTED]",
    "github": "[REDACTED]"
  }
}
```

`original_hash` is computed from 4a; `content_hash` is computed from 4b;
`chain_hash` binds to `original_hash` (so redacting a different field set
later won't invalidate the chain).

## 5. Change procedure

When changing the audit_events shape:

1. Add a new `migrations/00N_*.sql` file (never edit existing migrations).
2. Update §1 column table above to match the post-migration schema.
3. Update `packages/core/src/audit/service.ts` if the change affects the
   `INSERT` statement or the hash inputs.
4. Run `pnpm verify:audit-schema` locally — it must exit 0.
5. Add a `migrations-chain.test.ts` row reference if needed (one of the
   defensive tests under `packages/core/src/__tests__/`).

## 6. Files of record

- Schema (canonical): `migrations/001_initial.sql` + later ALTER migrations
- Insert / hash code: `packages/core/src/audit/{service,chain}.ts`
- Verifier: `packages/core/src/audit/verify-chain.ts`
- Drift gate: `scripts/verify-audit-schema.mjs` + `pnpm verify:audit-schema`
