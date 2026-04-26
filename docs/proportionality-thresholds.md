# Proportionality thresholds

This repository deliberately keeps single-user-appropriate processes (no
CODEOWNERS, no changesets, no monorepo project references, no claims.yaml
registry, etc.). Each of those is **proportional** at a specific scale and
should be activated only when that scale is reached.

The numeric thresholds are **not** maintained here. They live in the
external SSOT used across this developer's projects:

```
~/.claude/da-tools/thresholds.json — key: proportionality_thresholds
```

This avoids drift between projects that share the same maintainer's
"when do I escalate?" decision (DIP — depend on the external SSOT, not on
copies). When proposing to escalate one of the items below, update the
SSOT first, then reference it from the relevant RFC.

Currently tracked escalation triggers:

- `external_contributor_pr_count` → CODEOWNERS, signed commits, RFC 6 sections
- `monorepo_packages_count` → TypeScript project references, build orchestrator
- `contributor_count` → changesets, release-please, multi-author audit chain
- `external_published_claims_count` → claims.yaml registry, auto-generated README
- `mcp_clients_count` → MCP tools namespace split (read/write/audit)

See the SSOT for current values and rationale.
