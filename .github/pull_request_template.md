## Summary

<!-- One or two sentences on what this PR changes and why. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation only
- [ ] Refactor / cleanup
- [ ] Breaking change

## Claim gate (ASI mapping & Architecture contracts)

If this PR **adds or modifies** any claim in `README.md` / `README.ko.md` under:

- `OWASP ASI mapping` (ASI01–ASI10), or
- `Architecture contracts & verification status`, or
- the `Security model` section

…then complete the following:

- [ ] Matching test file exists and is green (e.g. `hitl-enforcement.test.ts`, `audit-chain.test.ts`, `task-atomicity.test.ts`, `chain.test.ts`, `migrations-chain.test.ts`)
- [ ] `.github/claim-map.yml` updated if a new claim was added (or an existing mapping changed)
- [ ] Verification status label is set in README (`[passed]` / `[pending E2E]` / `[unverified]` / `[out of scope]`)
- [ ] The `claim-check` GitHub Actions workflow passes on this PR

If this PR changes `schema_migrations` order or adds a new migration:

- [ ] `assertSchemaChain([...])` in `packages/server/src/server.ts` updated
- [ ] README `Schema chain preflight` line updated in both `README.md` and `README.ko.md`
- [ ] `CHANGELOG.md` documents the new migration

## Testing

<!-- How did you verify this change? -->

- [ ] `pnpm build` succeeds
- [ ] `pnpm test` green
- [ ] (if routes or transports touched) Manual smoke test or new E2E test added

## Single-user scope note

gijun-ai is a **personal single-user tool**. External PRs are welcome but not guaranteed a response. For team mode, RBAC, or multi-user separation-of-duties, fork the project — those features are out of scope for this repo.
