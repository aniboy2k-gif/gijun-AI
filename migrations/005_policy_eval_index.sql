-- Migration 005: Policy evaluate composite index + hitl_trigger immutability trigger
-- QC1: composite index matches the evaluate() WHERE clause shape
--     (policy_kind, tool_name, action_type, is_active).
-- NH4: DB-level guard that hitl_trigger is write-once. Once set on a task
--     (createTask stores a non-null JSON trigger), subsequent UPDATEs to that
--     column are rejected with RAISE(ABORT). This enforces the v0.1.1 promise
--     that hitl_trigger is immutable even against raw SQL paths.

CREATE INDEX idx_policies_eval
  ON policies(policy_kind, tool_name, action_type, is_active);

CREATE TRIGGER hitl_trigger_immutable
BEFORE UPDATE OF hitl_trigger ON tasks
WHEN OLD.hitl_trigger IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'hitl_trigger is immutable once set');
END;
