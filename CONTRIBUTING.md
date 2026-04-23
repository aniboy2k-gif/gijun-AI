# Contributing to gijun-ai

> **Status: personal single-user tool.** Issues and PRs are welcome, but this is an individual maintainer's project — responses are not guaranteed. For team mode / RBAC / multi-user needs, **fork** the project.

## Before opening an issue or PR

- Read `README.md` top-of-page **"Status"** line — this tool is a solo audit workbench, not a framework for team adoption. Feature requests that require multi-user semantics will usually be declined with a "fork required" reply.
- Check `docs/adoption-scenarios.md` — if your use case is in a `✗` row (team adoption, production dependency, compliance), a PR here is unlikely to land. Fork instead.
- Check `docs/public-status-dod.md` — gijun-ai targets **L2 reference-only public**. PRs that would push the project into L3 territory (community-wide SLA, response guarantees) require a separate conversation first.

## Local development

```bash
git clone https://github.com/aniboy2k-gif/gijun-AI.git
cd gijun-AI
pnpm install
pnpm build
pnpm test       # 30 core unit tests + 8 server E2E tests
```

Requirements: Node.js ≥ 22 (for native `node:sqlite`), pnpm ≥ 9.

## Pull request workflow

1. **Scope the PR to a single framework axis.** gijun-ai's concerns split into five axes — Branding (A) / Reliability (B) / Authority (C) / Operations (D) / Legal (E). See `docs/project-framework.md`. A good PR touches one axis; PRs that touch multiple axes should be split.
2. **Match the commit style.** Conventional Commits (`fix:`, `feat:`, `docs:`, `refactor:`, `chore:`, `ci:`, `test:`). See `git log` for examples.
3. **Update the README claim gate.**
   - If the PR adds or modifies an `ASI` mapping claim or an `Architecture contract`, add a matching entry to `.github/claim-map.yml` so the `claim-check` CI job validates it.
   - If the PR changes a migration order, update `assertSchemaChain([...])` in `packages/server/src/server.ts` **and** the README `Schema chain preflight` line in both `README.md` and `README.ko.md`.
4. **Run the test suite.** `pnpm -r test` must be green. New features should include at least one unit test under `packages/core/src/__tests__/` or one E2E test under `packages/server/src/__tests__/`.
5. **Fill in the PR template.** `.github/pull_request_template.md` guides the claim-gate and testing checkboxes.

## What is out of scope

gijun-ai deliberately does not accept contributions for:

- Multi-user authentication / RBAC / per-user tokens (would change C-1a scope — fork required)
- SaaS / cloud hosting integration
- Organization-level billing
- Replacing SQLite with a networked database
- LangChain / Mastra / other framework adapters (v0.3+ wishlist, low priority)

If your PR addresses one of these, please fork rather than opening an issue here.

## Questions

Open a Discussion (GitHub Discussions) or file an Issue with the `question` label. Expect a slow response — this is a single-maintainer side project.

## License

By contributing, you agree that your contributions are licensed under the MIT License (see `LICENSE`).
