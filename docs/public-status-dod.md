# Public Status — Definition of Done (DoD)

> gijun-ai's level-based public status framework.
>
> Each level above L1 has a concrete, testable Definition of Done. A level is
> claimed only when **every** checkbox is green — there is no "mostly L2" or
> "almost L3". This pattern mirrors the `verification.md` Iron Law: no
> completion claim without fresh verification evidence.

---

## Levels

| Level | Status | What it signals | Fork required for… |
|:-----:|--------|-----------------|--------------------|
| **L1** | Personal experiment | Code exists on disk / private | Anything public |
| **L2** | Reference-only public | Code is public, reproducible, honestly labeled | Production adoption |
| **L3** | PR-accepting | Community can contribute, bug reports are triaged | Team / RBAC / multi-user |
| **L4** | Production-dependency-safe | **Out of scope for gijun-ai.** Fork required. | — (fork needed) |

gijun-ai's **current target is L2**. L3 is evaluated only after the v0.2 milestone. L4 is deliberately out of scope for this project (see `README.md` — "Out of scope (fork required)").

---

## L1 → L2: Reference-only public — DoD checklist

All of the following must be green before the repository description is updated to "L2 reference-only public":

### Documentation integrity
- [ ] README badge `version` ↔ `package.json` `version` ↔ most recent `git tag` all match (automatically verified by `claim-check` workflow)
- [ ] `CHANGELOG.md` has an entry for the current `package.json` version
- [ ] README has no `governance platform`, `governance layer`, or `Deterministic canonical JSON` phrasing (replaced with honest descriptions)
- [ ] README top-of-page contains **"Status: personal single-user tool — not a production dependency"**
- [ ] README Roadmap explicitly lists "team mode / RBAC / SaaS" under **Out of scope (fork required)**

### Build & test reproducibility
- [ ] `pnpm install && pnpm build && pnpm test` green on Node 22 LTS, macOS (local)
- [x] `pnpm install && pnpm build && pnpm test` green on Node 22 LTS, Ubuntu (via GitHub Actions `ci.yml` — added in v0.1.2)
- [ ] At minimum: 30 unit tests from v0.1.1 all pass
- [ ] `LICENSE` file exists at repository root with the full MIT license text

### Claim-to-code integrity
- [ ] `.github/workflows/claim-check.yml` passes — every `ASI` and `Architecture contract` claim in README is backed by a file/test listed in `.github/claim-map.yml`
- [ ] Every `ASI01`–`ASI10` entry in README carries a verification label (`[passed]` / `[pending E2E]` / `[unverified]` / `[out of scope]`)
- [ ] Every architecture contract carries the same label in the `Status` column of the contracts table

### Honesty of retroactive claims
- [ ] `CHANGELOG.md` v0.1.1 entry explicitly states that ASI08 was **documented but not enforced in v0.1.0** — not worded as self-congratulation about v0.1.1

### Issue hygiene
- [ ] Phase H blocker issues (4 items: ASI08 release gate, C-1a scope, canonical JSON honesty, L2 DoD) are linked to closed issues or commit SHAs

**When all boxes above are checked** — update the GitHub repository description to:
`Personal single-user AI agent audit workbench (L2 reference-only public). Not a production dependency.`

---

## L2 → L3: PR-accepting — DoD checklist (v0.2+ only)

After the v0.2 milestone (E2E tests + CI matrix + OSS community assets shipped), re-evaluate against these:

- [ ] `.github/workflows/ci.yml` runs `build + test` matrix across Node 22/24 × macOS/Ubuntu and has been green for at least one week
- [ ] At least 5 end-to-end integration tests exist under `packages/server/src/__tests__/` and `packages/mcp-server/src/__tests__/`
- [ ] `.github/ISSUE_TEMPLATE/bug_report.yml` and `feature_request.yml` present
- [ ] `CONTRIBUTING.md` exists and describes the PR workflow
- [ ] `CODE_OF_CONDUCT.md` exists (Contributor Covenant is fine)
- [ ] Maintainer commits to a response SLA: new Issues and PRs get at least an initial "received — will review by <date>" acknowledgment within **72 hours**. This is a public commitment — if it cannot be honored, stay at L2.
- [ ] Dependabot enabled; CodeQL scan runs on `main`

**Important**: L3 is **not automatic** after v0.2 is shipped. Staying at L2 is a legitimate choice if the maintainer cannot sustain the 72-hour response SLA. L2 is honest about limits; L3 imposes community expectations.

---

## L3 → L4: Production-dependency-safe — **Out of scope for this project**

Reaching L4 requires multi-user authentication, RBAC, durable audit replication, 24-hour security-patch SLA, and formal compliance work (SOC2 / ISO27001 / etc.). These are all explicitly out of scope for gijun-ai.

If you need L4-grade capabilities, **fork the project**. The MIT license allows this. The architecture is designed to be legible for adaptation in a single sitting — see `docs/project-framework.md` for the 5-axis framework that separates single-user scope from the parts that would need to be rewritten for team operation.

---

## Enforcement

- **Tooling**: `.github/workflows/claim-check.yml` enforces most of the L2 documentation-integrity checklist automatically.
- **Human**: The "Honesty of retroactive claims" and "maintainer SLA" items cannot be automated — they are honor-system commitments verified by the PR reviewer.
- **Iron Law**: No level is claimed until **every** checkbox is green. Partial compliance does not count.

---

## Quarterly drift checklist

Run this on every quarterly review, or before tagging any release. Five
fields catch the drift modes that have actually surfaced (workspace
descriptions, README "Known Limitations", DoD checkboxes, ASI labels,
CHANGELOG/`/health` version alignment). If the project ever crosses
**10 ASI-or-contract claims** or **2 outside contributors**, replace this
checklist with a structured `claims.yaml` registry — until then a
markdown checklist beats a build-time tool.

- [ ] All `packages/*/package.json` `description` fields use "audit/verification workbench" wording (no `governance platform/layer`)
- [ ] README "Known Limitations" reflects current state (no items already shipped, no items genuinely missing)
- [ ] DoD checkboxes match shipping state (no `v0.2 adds this` for items already merged)
- [ ] All ASI labels in README match `claim-map.yml` and `[passed: scoped]` notes are still accurate
- [ ] CHANGELOG has an entry for current `package.json` version and `/health` reports the same string

## Extension thresholds (when a heavier tool becomes worth it)

These quantitative triggers replace gut-feel "we should adopt X". Below
the threshold the proportional remedy in this doc / CONTRIBUTING is
expected to suffice; at or above, re-evaluate.

- **changesets / monorepo release tooling** → 2+ active contributors
- **`claims.yaml` structured registry + README generation** → 10+ ASI-or-contract claims
- **ESLint rule / wrapper enforcing `requireToken`** → 3+ external contributor PRs adding routes
- **MCP tools namespace split (read/write/audit)** → 3+ MCP clients integrating against the surface
- **redaction policy externalisation + `redaction_policy_hash`** → first concrete request to extend pattern set, OR the v0.2 milestone (whichever comes first)
