-- Migration 004: Cost Budget support (additive — no table recreation)
-- Adds `policy_kind` to distinguish standard allow/deny policies from budget (cost_limit) policies.
-- Adds `priority` for deterministic policy selection with explicit user-defined ordering.

ALTER TABLE policies ADD COLUMN policy_kind TEXT NOT NULL DEFAULT 'standard'
  CHECK(policy_kind IN ('standard', 'budget'));

ALTER TABLE policies ADD COLUMN priority INTEGER NOT NULL DEFAULT 0
  CHECK(priority >= 0);

CREATE INDEX idx_policies_kind ON policies(policy_kind, is_active);
