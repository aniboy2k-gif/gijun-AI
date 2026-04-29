-- Migration 008: External sync tracking fields for tasks
-- Adds external_id + external_source to support inbound events from external systems
-- (e.g., bulletin-board CSR outbox → gijun-AI task mirror)

ALTER TABLE tasks ADD COLUMN external_id TEXT;
ALTER TABLE tasks ADD COLUMN external_source TEXT;

-- Unique index enforces one task per (source, external_id) pair.
-- WHERE clause excludes rows where external_id IS NULL (regular tasks).
CREATE UNIQUE INDEX idx_tasks_external_sync
  ON tasks(external_source, external_id)
  WHERE external_id IS NOT NULL;
