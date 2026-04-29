-- Migration 006: cost parse-status columns
--
-- Adds multi-provider cost tracking metadata to the traces table.
-- append-only principle: no UPDATE or backfill of existing rows.
-- Existing rows default to cost_source='legacy' and parse_status='legacy'
-- so that legacy recordTrace() callers are distinguished from parsed callers.
--
-- cost_usd_micros: canonical cost in integer micros (1 USD = 1,000,000 micros)
--   to avoid float rounding errors. Supersedes cost_usd (now deprecated).
--   NULL means cost was not measured (failed parse); zero is valid for free ops.
--
-- cost_source: provenance of the cost value
--   'parsed'    — computed by a provider-specific ICostParser
--   'estimated' — conservative estimation used when parse fails
--   'legacy'    — written by the old recordTrace() before this migration
--
-- parse_status: outcome of the cost-parsing step
--   'success' — token counts and cost both resolved
--   'failed'  — raw response could not be parsed; cost_usd_micros uses estimation
--   'legacy'  — pre-migration row; no parsing was attempted
--
-- raw_payload_hash: sha256 fingerprint (format: "sha256:<64-hex>") of the
--   raw provider response BEFORE any redaction. Stored for audit reproducibility.
--   The full payload is never persisted here (security boundary: §rawPayload).

ALTER TABLE traces ADD COLUMN parse_status TEXT NOT NULL DEFAULT 'legacy'
  CHECK(parse_status IN ('success', 'failed', 'legacy'));

ALTER TABLE traces ADD COLUMN parse_error TEXT;

ALTER TABLE traces ADD COLUMN raw_payload_hash TEXT;

ALTER TABLE traces ADD COLUMN cost_usd_micros INTEGER DEFAULT NULL;

ALTER TABLE traces ADD COLUMN cost_source TEXT NOT NULL DEFAULT 'legacy'
  CHECK(cost_source IN ('parsed', 'estimated', 'legacy'));

-- Composite index for budget aggregation queries.
-- Deferred to here (not inline with table creation) to allow query-pattern
-- validation after shipping (per plan DA M2 guidance).
CREATE INDEX idx_traces_cost_status
  ON traces(parse_status, cost_source, created_at);
