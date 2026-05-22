# Threat Model — CSR #775 (PR #43 Integrated Security Hardening)

생성일시: 2026-05-23
출처: CSR #771 외부 4-AI Tier 1 (security) DA 검증 (Gemini → ChatGPT → Claude Web → DeepSeek)
관련: CSR #758 (PR #42 Settings tab — base), CSR #775 (PR #43 — 본 문서)

## 1. Threat Model Boundaries

### 1.1 Attacker Classes (in-scope)

| Class | 정의 | Capability |
|---|---|---|
| **(a) External web attacker** | 사용자가 방문한 악의 페이지 (CSRF, XSS) | 동일 출처 cookie 사용 못함 (SameSite=Strict). 가능: cross-origin fetch with simple headers / preflight 발생 시 차단됨 |
| **(b) Malicious local user** | shell 접근 가진 같은 host 사용자 | env-var 설정·파일 시스템 접근·process inspection / 자신의 token rotation 가능 / **타 user의 process 메모리는 ptrace 권한 필요** |
| **(c) Compromised sibling process** | Node.js cluster mode worker · worker_thread · forked child | 동일 process memory 공유 (worker_threads) 또는 별도 process (cluster.fork) / **cluster guard로 boot abort** (P4 M6 적용) |
| **(d) Supply-chain via env-var injection** | orchestration layer (Docker/k8s/CI)에서 env-var 주입 | NODE_ENV·AGENTGUARD_TOKEN·AGENTGUARD_ENV_FILE 모든 env-var 제어 가능 / **AGENTGUARD_CONFIG_HMAC_KEY 필수 + AGENTGUARD_TEST_MODE HMAC로 차단** (P1 C2 + P2 C1 적용) |

### 1.2 Trust Boundary

- **현재**: 단일 Node.js process (single-instance, cluster guard로 강제)
- **미래**: optional cluster + 공유 filesystem (별건 CSR — Redis SETNX 또는 PostgreSQL advisory lock)

### 1.3 Deployment Topology

```
[End user CLI] ──┐
                 ├─→ Node.js single-process ──→ SQLite (audit_events chain)
[Web dashboard]──┘    ↓ listen 127.0.0.1:3456     ↓
                     middleware/auth.ts            chain.ts (sha256 + verify-chain.ts)
                     ↓
                     token-holder.ts (HMAC-SHA256 + 5s grace)
```

- 모든 endpoint는 localhost (127.0.0.1) bind. 외부 노출 없음
- web dashboard는 SameSite=Strict cookie 권고 (browser path)
- CLI는 X-AgentGuard-Token header (인증) + X-AgentGuard-Confirm-Rotate (CSRF guard)

### 1.4 Crown Jewels

| 자원 | 보호 mechanism |
|---|---|
| `AGENTGUARD_TOKEN` (full API auth) | timing-safe compare (P6 H4 verified) + 5초 grace period + HMAC env-file gate (P1·P2) |
| `.env.local` 파일 | atomic write (tmp + rename) + symlink check + chmod 0600 + AGENTGUARD_TEST_MODE HMAC gate |
| `audit_events` chain | hash chain (prev_hash + content_hash + chain_hash sha256) + tamper detection (verify-chain.ts) + SQLite WAL mode |
| `AGENTGUARD_CONFIG_HMAC_KEY` | production 필수 + 별도 env-var (token 파생 ❌) — migration guide 별도 |

### 1.5 In-Scope Failures

- Token theft (header / log / crash dump 통한 추출)
- Audit chain manipulation (DB 직접 modify)
- Configuration tampering (`.env.local`·NODE_ENV 우회)
- CSRF (cross-origin POST)
- **Localhost bind-race** — orchestration layer가 port ownership 검증 실패 시 in-scope (P9 L10 refinement)

### 1.6 Out-of-Scope (PR #43)

- Cross-host network MITM (localhost binding only)
- Supply-chain at npm publish 시점 (별건 CSR — npm audit + provenance)
- Hardware attacks (host compromise via firmware/BMC 등)

## 2. F1 — X-AgentGuard-CLI Header (Plan v2 P5 H5 Option B)

### 2.1 Decision: Option B (Header = Path-Hint, NOT Auth)

CSR #771 R3 Claude Web M-R3-2 + DeepSeek H2 발견에 따라 X-AgentGuard-CLI header를 **secret 아닌 path-hint**로 사용. 인증은 token-only (`X-AgentGuard-Token` + timing-safe compare).

```
브라우저 경로:
  fetch('/auth/rotate-token', {
    method: 'POST',
    headers: { 'X-AgentGuard-Token': token, 'X-AgentGuard-Confirm-Rotate': 'yes' },
    credentials: 'include',
  })
  → SameSite=Strict cookie + Origin header 검증 (127.0.0.1/localhost) + token 인증

CLI 경로:
  curl -H 'X-AgentGuard-Token: <token>' -H 'X-AgentGuard-Confirm-Rotate: yes' \
       http://127.0.0.1:3456/auth/rotate-token
  → Origin header 없음 → CLI 식별 → 통과 (token 인증)
```

### 2.2 Residual Risks (Honest Disclosure)

| Risk | 설명 | Mitigation |
|---|---|---|
| **Same-origin XSS → header set** | dashboard에 XSS 취약점 있으면 attacker JS가 X-AgentGuard-Token header 설정 가능 | CSP `default-src 'self'` + dashboard 컴포넌트 XSS-free 검증 + audit redaction 강화 |
| **Local user (b) inspects token** | shell 접근자는 process env-var 또는 `.env.local` 파일 직접 read 가능 | 본 PR 범위 외 (host-level 격리 책임). chmod 0600 + audit log로 access 기록 |
| **Cross-origin without preflight** | Simple POST (no custom headers, content-type=text/plain)는 preflight 회피 가능 | `X-AgentGuard-Confirm-Rotate: yes` 필수 → custom header → 모든 cross-origin POST는 preflight 강제 |
| **Browser fetch credentials=omit** | credentials=omit인 cross-origin fetch는 cookie 미전송이지만 header만으로는 인증 불가 | token-only 인증이므로 영향 없음 |

### 2.3 Architectural Note (Option A vs Option B 선택 이유)

Option A (HMAC over nonce + LRU nonce store + 별도 key) 거부 사유:
- nonce store 운영 부담 (single-instance 가정 위반 시 race)
- HMAC 키 관리 복잡 (rotation·storage·leakage 위험)
- 본질적으로 인증은 token이 담당 — header는 path 분기 hint
- DeepSeek H2 발견: HMAC 키가 token 파생 시 brute-force 가능 → 별도 key 도입 시 또 다른 secret 관리 필요

**KISS 원칙 (golden-principles.md)**: 불필요한 abstraction 회피. Header는 hint, 인증은 token.

## 3. F2 — Audit Log Hardening (Plan v2 P7 H3)

### 3.1 현재 mechanism

- **Application layer**: hash chain (sha256 prev/original/content/chain) — tamper detection
- **Database layer**: SQLite WAL mode + chmod 0600
- **OS layer**: ⚠️ chattr/chflags **미적용** (현재 0건 호출 — P7 H3 신규 도입)

### 3.2 P7 H3 신규 — OS append-only flag

```
Linux:  chattr +a <audit-db-path>     (root 권한 또는 CAP_LINUX_IMMUTABLE 필요)
macOS:  chflags uappnd <audit-db-path> (user-level 가능)
```

production NODE_ENV에서 chattr 실패 → boot abort (`audit_append_only_flag_failed`).
non-prod에서 chattr 실패 → warning log + continue (dev 환경 제약).

### 3.3 Residual Risks

| Risk | Mitigation |
|---|---|
| **Root user (attacker class b 변형)** | chattr -a로 flag 제거 가능 — host-level 격리 책임 외 |
| **WORM external sink 미적용** | CSR #777 carry-forward (별건 hardening CSR) |
| **chain repair by chain attack** | hash chain은 tamper detection만, prevention은 OS flag 의존 |

## 4. F3 — Single-Instance Invariant (Plan v2 P4 M6, ✅ done)

cluster mode·worker_threads·child_process.fork 모두 boot abort. Multi-process 미래는 Redis SETNX 또는 PostgreSQL advisory lock (별건 CSR).

## 5. F4 — Token Rotation 5s Grace (CSR #758 base, CSR #771 R3 M-R3-3 NOT applied here)

- 현재: `Date.now()` 기반 5초 grace (token-holder.ts line 4 + 49)
- 결함: NTP-skew 영향 가능 (CSR #771 R3 M-R3-3)
- 본 PR에서 fix 미적용 — **별건 CSR carry-forward** (사용자 결정 (B) 답습, CSR #777에 포함 가능)

## 6. F5 — Configuration Tampering (Plan v2 P1+P2, ✅ done)

- **C1 (P2 ✅)**: env-file 로드 시 NODE_ENV + AGENTGUARD_TEST_MODE HMAC 통합 검증
- **C2 (P1 ✅)**: AGENTGUARD_CONFIG_HMAC_KEY 필수 + boot-epoch anti-replay + TTL
- **L11 (P9 예정)**: CWD allowlist (Plan v1) → AGENTGUARD_TEST_MODE HMAC env var (Plan v2 통합)

## 7. References

- 출처 DA: `/tmp/da-chain-1779432199/final.txt` (CSR #771 4-AI Tier 1 security)
- CWE 매핑: CWE-352 (CSRF) · CWE-916 (token hash) · CWE-208 (timing side-channel) · CWE-345 (data authenticity) · CWE-330 (HMAC key origin) · CWE-367 (TOCTOU) · CWE-732 (incorrect permission) · CWE-807 (untrusted input — N/A, UA 분기 없음)
- OWASP: A01 (Broken Access Control) · A04 (Insecure Design) · A05 (Insecure Configuration) · A07 (Insufficient Logging)
- Plan: `prompt_plan.md` (LOCAL `.gitignore`된 작업 계획)
- Migration guide: `docs/migration-CSR-775.md` (P10에서 신설)

## 8. Future Work (Out-of-PR-43 Carry-Forward)

- WORM external logging sink — CSR #777
- Multi-process token rotation (Redis SETNX) — 별건 CSR
- NTP-skew safe grace period (performance.now() monotonic) — 별건 CSR
- DA template "reject section" 의무 — CSR #778
- OWASP A01/A05 boundary docs — CSR #778
- Mitigation enforceability tagging — CSR #778
