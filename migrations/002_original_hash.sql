-- Migration 002: original_hash 컬럼 추가
-- chain_hash가 redact된 payload 기반이면 원본 검증 불가 문제 해결.
-- original_hash = redact 전 원본 데이터의 hash (chain_hash 계산 기준)
-- content_hash = 실제 저장된(redact 후) payload의 hash

ALTER TABLE audit_events ADD COLUMN original_hash TEXT;

-- 기존 행: original_hash가 없으므로 content_hash로 초기화 (backward compatibility)
-- 기존 chain_hash는 이미 content_hash 기반으로 계산되어 있음
UPDATE audit_events SET original_hash = content_hash WHERE original_hash IS NULL;
