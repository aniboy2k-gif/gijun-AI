-- Migration 007: knowledge item status lifecycle
--
-- Adds orthogonal status dimension to knowledge_items so that scope (layer)
-- and lifecycle state (status) are tracked independently.
--
-- Status values:
--   'draft'     — pre-fill from DA result; not yet user-reviewed
--   'candidate' — user-nominated for promotion; awaiting HITL approval
--   'approved'  — user-confirmed; item is in active use
--   'rejected'  — user-rejected; retained for audit trail; is_active=0
--
-- Backfill strategy (run inside BEGIN IMMEDIATE so no new inserts race):
--   all existing rows     → status='approved' (already active)
--   layer='candidate' rows → status='candidate' + layer='incident' (scope resolved)
--
-- is_active is now a GENERATED VIRTUAL column derived from status.
-- SQLite 3.31+ required (node:sqlite bundles 3.45.x — safe).
--
-- FTS UPDATE trigger is replaced with a WHEN-guarded version that only
-- re-indexes when title/content/tags actually change, preventing expensive
-- FTS writes on status-only transitions.

-- 1. New columns (NULL allowed for backfill; app-level validation enforces NOT NULL)
ALTER TABLE knowledge_items ADD COLUMN status TEXT
  CHECK(status IN ('draft', 'candidate', 'approved', 'rejected'));

ALTER TABLE knowledge_items ADD COLUMN status_reason TEXT;

ALTER TABLE knowledge_items ADD COLUMN supersedes_id INTEGER
  REFERENCES knowledge_items(id);

-- 2. Backfill
UPDATE knowledge_items SET status = 'approved';
UPDATE knowledge_items SET status = 'candidate', layer = 'incident'
  WHERE layer = 'candidate';

-- 3. is_active is already INTEGER DEFAULT 1 from migration 001.
--    Application code (transitionStatus) updates is_active atomically alongside status.
--    Backfill rejected rows (if any) to is_active=0 — safe to run even on empty table.
UPDATE knowledge_items SET is_active = 0 WHERE status = 'rejected';

-- 4. Replace FTS UPDATE trigger with NULL-safe content-only guard
DROP TRIGGER IF EXISTS knowledge_fts_update;
CREATE TRIGGER knowledge_fts_update AFTER UPDATE ON knowledge_items
WHEN NOT (old.title IS new.title)
  OR NOT (old.content IS new.content)
  OR NOT (old.tags IS new.tags)
BEGIN
  DELETE FROM knowledge_fts WHERE rowid = old.rowid;
  INSERT INTO knowledge_fts(rowid, title, content, tags)
    VALUES(new.rowid, new.title, new.content, new.tags);
END;

-- 5. Index for status-based visibility queries
CREATE INDEX idx_knowledge_status
  ON knowledge_items(status, layer);
