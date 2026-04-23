# Project Framework — 5 Axes of Concern

> gijun-ai's concerns decompose into five orthogonal axes. Each axis has a
> clear boundary rule for what belongs inside it. This avoids the original
> 4-axis design's MECE violation where tests, CI, and plaform concerns were
> all tangled under "reliability".

| Axis | Concern | Belongs here if… | Does NOT belong here |
|:----:|---------|------------------|----------------------|
| **A** | Branding & documentation integrity | A change is **pure text** in README / CHANGELOG / `docs/` and does not touch behavior | Anything that requires a code change |
| **B** | Reliability & verification (claim→proof) | The change adds or modifies an **automated test**, a release-gate check, a migration, or a source-level invariant assertion | Pure documentation; architectural redesign |
| **C** | Authority & policy architecture | The change affects **who is allowed to do what** — tokens, RBAC, HITL gates, policy effects, multi-party authorization | Test-only changes; documentation |
| **D** | Public-operation readiness | The change is about **repository meta-infrastructure** — `.github/`, CI workflows, Issue/PR templates, CONTRIBUTING, release notes | Product code; tests |
| **E** | Legal & external-dependency risk | The change is about **licensing, PII handling, compliance, or upstream spec/ToS drift** — LICENSE, SPDX, license-checker, MCP spec pin, model-provider ToS | Internal-only code changes |

---

## Boundary rules (resolving "which axis is this?")

When a change could be assigned to more than one axis, apply these tiebreakers in order:

1. **If it touches code that executes at runtime → B or C, not A.** A is text-only.
2. **If the code is about authorization decisions → C, not B.** B is about "does the promised behavior happen", C is about "should anyone be allowed to trigger it at all".
3. **If the repository is public-consumer-facing (workflow, template, issue form) → D, not anywhere else.** D is the meta-infrastructure axis.
4. **If the concern originates outside the repository (a spec changes, a law changes, an upstream library relicenses) → E.** E is the world-we-don't-control axis.
5. **If two axes still apply equally, pick the one with the narrower definition.** Axis A is the broadest trap — demote everything else before placing a concern in A.

---

## Per-axis examples (from Phase H/I/J)

### Axis A — Branding & documentation integrity
- Replace `governance platform` with `audit/verification workbench` in README
- Fix `version-0.1.0` badge to reflect current `package.json` version
- Move Korean README to `docs/ko/` (or keep at root — text-only decision)

### Axis B — Reliability & verification
- `claim-check` workflow asserts README claims ↔ test files exist
- Add `hitl-enforcement.test.ts` to back the ASI08 claim
- Add 5 E2E integration tests for REST + MCP transport paths (v0.2)
- Document `canonical JSON is not RFC 8785` honestly — this touches source-level invariant even though the edit is in README (the invariant is weaker than claimed, and documenting that is a B-axis change)

### Axis C — Authority & policy architecture
- Confirm **C-1a single-user scope**: HITL as self-approval speed-bump, not multi-party governance
- Two-token separation (`AGENTGUARD_TOKEN` vs `AGENTGUARD_MCP_TOKEN`) — MCP compromise does not grant REST access
- Out-of-scope decision: no RBAC, no per-user tokens, no leader-elected replication

### Axis D — Public-operation readiness
- `.github/workflows/ci.yml` build+test matrix (Node 22/24 × macOS/Ubuntu)
- `.github/ISSUE_TEMPLATE/bug_report.yml` + `feature_request.yml`
- `CONTRIBUTING.md` with PR workflow
- GitHub Releases for v0.1.0 and v0.1.1 populated from CHANGELOG
- Dependabot + CodeQL

### Axis E — Legal & external-dependency risk
- `LICENSE` file present with MIT full text
- `license-checker` script to detect incompatible transitive licenses
- `@modelcontextprotocol/sdk` upper-bound pin (protection against breaking MCP spec changes)
- Model-provider ToS monitoring (record provider per trace so policy changes are traceable)
- PII redaction path (`redactPayload` + GDPR erasure procedure)
- Fork-propagation clarity (MIT allows fork; upstream cannot recall)

---

## Why five, not three or seven?

The first-pass design used three axes (docs / code / infra). That made every ASI-mapping question double-booked — is the ASI08 claim a `docs` change or a `code` change? Both, simultaneously. **Five axes resolve that**: the claim text is A, the test that backs it is B, the authorization-model decision behind it is C.

Seven axes were considered (splitting D into "CI" and "community artifacts" and E into "licensing" and "upstream dependencies"). They were rejected because the boundary rules above cleanly resolve those sub-distinctions without needing a separate axis.

If a future concern does not fit any of A–E, add a new axis rather than stretching an existing one.

---

## Usage

- **Planning**: When adding a backlog item, tag it with `A`, `B`, `C`, `D`, or `E`. A well-scoped PR touches **one** axis; PRs that touch multiple axes should be split.
- **Reviewing**: If a PR's changes don't match its declared axis, push back. Scope-creep usually shows up as a stealth B or C change inside a supposedly A-axis documentation PR.
- **Roadmap**: `docs/public-status-dod.md` references axes by letter so the DoD checklist is traceable to this framework.
