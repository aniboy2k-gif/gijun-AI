-- Migration 003: original_hash_type 컬럼 추가
-- original_hash 의미 체계를 스키마 레벨에서 명확화:
--   'redaction_pre' : redaction 전 원본 payload hash (migration 002 이후 신규 행)
--   'legacy'        : content_hash 대체값 (migration 002 이전 기존 행 — redaction 개념 없음)

ALTER TABLE audit_events ADD COLUMN original_hash_type TEXT DEFAULT 'legacy';

-- migration 002 이후 삽입된 행은 'redaction_pre' 의미.
-- 실제 삽입 시점 구분이 불가하므로, migration 002 적용 직전까지의 행을 'legacy'로 둔다.
-- 새로 appendAuditEvent로 기록되는 행은 서비스 코드에서 'redaction_pre'를 명시한다.
