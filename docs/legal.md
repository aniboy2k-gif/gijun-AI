# Legal & External-Dependency Risk (Axis E)

> This document covers the legal, licensing, and external-dependency concerns
> that define gijun-ai's **Axis E** (see `docs/project-framework.md`).
>
> None of this is legal advice. gijun-ai is a personal open-source project;
> consult your own counsel for your use case.

## License

gijun-ai is **MIT licensed**. The full text is in the repository root `LICENSE` file. SPDX identifier: `MIT`.

What this means in practice:

- **You can fork**, modify, and redistribute — including under different license terms (MIT is permissive).
- The upstream project **cannot revoke** forks that have already been created.
- No copyleft obligation; your derivative work is not required to be open source.
- No patent grant beyond what MIT implies.

## Fork propagation

Once you fork, upstream maintainers cannot:

- Force your fork to archive.
- Force your fork to adopt upstream security patches.
- Revoke your use of the MIT-licensed code already in your fork.

If you maintain a fork, you take on full responsibility for security patching, license review of your own dependencies, and your users' safety.

## PII / data-subject rights

gijun-ai stores Claude/LLM session prompts and responses locally in a SQLite file. If your use case processes **personal data** (as defined by GDPR, CCPA, PIPA, etc.):

- The `payload` column can contain PII (user prompts, names, identifiers).
- The `redactPayload()` function in `packages/core/src/audit/service.ts` blanks `payload` while preserving `original_hash` — audit chain integrity survives redaction.
- For a right-to-erasure request, call `redactPayload(auditEventId, reason)` for each affected event. The event remains in the chain but carries only the hash.
- This is a **technical redaction primitive**. Compliance with GDPR/CCPA/PIPA requires more — documented retention policy, DSAR response procedure, breach notification runbook, Data Processing Agreements with downstream consumers, etc. gijun-ai provides none of this out of the box.

**If your use case is regulated**: either build the compliance layer on top of gijun-ai yourself, or use a vendor that has already done that work (Langfuse Enterprise, Arize, etc.).

## External dependency risk

gijun-ai depends on external specifications and services that can change out from under us:

### MCP specification
- `@modelcontextprotocol/sdk` is pinned in `packages/mcp-server/package.json`. Pin carefully; upstream spec changes have previously broken client compatibility.
- If a major MCP spec change ships, expect a forking fork (no pun): the MCP server may not be forward-compatible. Check `CHANGELOG.md` for tested MCP SDK versions.

### Claude Code / model-provider ToS
- gijun-ai is agnostic to the model provider — it just records what you give it.
- Claude Code's terms of service and Anthropic's model use policies evolve. If Anthropic's policy changes in a way that restricts agent telemetry logging, gijun-ai may need to be reconfigured (e.g., by default-redacting certain payload fields).
- There is no automated monitor for provider ToS changes. Check upstream periodically.

### Node.js experimental APIs
- `node:sqlite` was `experimental` in Node.js 22.x. gijun-ai uses it. Node 24 LTS has promoted it, but users on older `22.x` lines may see `ExperimentalWarning` logs.
- If Node 22 LTS EOL arrives before Node 24 adoption catches up, gijun-ai may migrate to `better-sqlite3`.

## Third-party license compatibility

Current runtime dependencies (direct, not transitive):
- `express` — MIT
- `zod` — MIT
- `@modelcontextprotocol/sdk` — MIT
- `zod-to-json-schema` — ISC

All compatible with MIT-licensed distribution. No copyleft obligations.

To audit transitive dependencies, run:

```bash
npx license-checker --production --summary
```

If a transitive dependency introduces a GPL-family license, the safe response is to pin an earlier version or find an alternative — **do not re-license gijun-ai to GPL** just to absorb a dependency.

## Archive / strand scenarios

If the maintainer steps away:

- The MIT license remains in effect. Forks can continue.
- The repository may be archived (read-only). Archiving does not delete the history.
- Open issues / PRs will get no response — see `CONTRIBUTING.md`.

If you depend on gijun-ai for anything important, **mirror the repository** (`git clone --mirror`) and be prepared to fork if upstream goes silent.

## What this project does **not** promise

- No Security Advisory SLA. Security issues may be fixed slowly.
- No compliance certification (SOC2, ISO27001, HIPAA, etc.).
- No long-term version-compatibility guarantees beyond semver major/minor intent.
- No warranty (standard MIT disclaimer applies).
