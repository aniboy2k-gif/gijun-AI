# Migration Guide — CSR #775 (PR #43)

생성일시: 2026-05-23
출처: CSR #771 외부 4-AI Tier 1 (security) DA 검증 결과 통합 fix
관련: CSR #775 (본 PR), CSR #758 (선행 PR #42 base)

## 영향 요약 (TL;DR)

| 변경 | 영향 | 조치 |
|---|---|---|
| **새 필수 환경변수** `AGENTGUARD_CONFIG_HMAC_KEY` | production NODE_ENV에서 미설정 시 boot abort | 키 생성 + 환경변수 등록 (아래 §1) |
| **AGENTGUARD_ENV_FILE 사용 제한** | NODE_ENV=test + valid HMAC token 둘 다 필요 | 테스트 환경 setup 변경 (§2) |
| **Cluster mode 차단** | `cluster.fork()`·worker_threads·child_process.fork 모두 boot abort | single-process 배포 보장 (§3) |
| **Audit DB append-only flag** | production에서 chattr/chflags 실패 시 boot abort | DB 파일 OS-level 권한 확인 (§4) |
| **Token comparison timing-safe** | 코드 변경 없음 (이미 적용 — regression test 추가) | — |
| **X-AgentGuard-CLI header (Option B)** | header가 secret 아닌 path hint로 명시 | docs 변경만, code 변경 없음 |

## 1. AGENTGUARD_CONFIG_HMAC_KEY (필수)

### 1.1 영향 범위
- `NODE_ENV=production` deployment 전체
- 미설정 시 boot 시점에 즉시 에러:
  ```
  agentguard_config_hmac_key_required_in_production:
    AGENTGUARD_CONFIG_HMAC_KEY env var must be set when NODE_ENV=production.
  ```

### 1.2 키 생성 (배포 환경에서 1회)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 출력 예: 64자 hex 문자열 (256-bit entropy)
```

### 1.3 환경변수 등록 방법별

#### Vercel / Railway / Fly.io
- 환경변수 UI에서 **Secret** 으로 등록 (로그 미노출)
- 키: `AGENTGUARD_CONFIG_HMAC_KEY`
- 값: 위에서 생성한 64자 hex

#### Docker / docker-compose
```yaml
# docker-compose.yml
services:
  agentguard:
    environment:
      - NODE_ENV=production
      - AGENTGUARD_CONFIG_HMAC_KEY  # 호스트 환경에서 inject
    # 또는 secrets 사용:
    secrets:
      - agentguard_config_hmac_key
```

#### bare metal / systemd
```ini
# /etc/systemd/system/agentguard.service
[Service]
EnvironmentFile=/etc/agentguard/secret.env  # chmod 0600, owner=agentguard:agentguard
```
secret.env 파일:
```
AGENTGUARD_CONFIG_HMAC_KEY=<64자_hex>
```

### 1.4 검증

```bash
# 정상 boot 확인
NODE_ENV=production AGENTGUARD_CONFIG_HMAC_KEY=<your_key> \
  node packages/server/dist/server.js
# 출력: [agentguard] server listening on http://127.0.0.1:3456

# 네거티브 테스트 — 키 누락 시 즉시 throw
NODE_ENV=production node packages/server/dist/server.js
# 예상: throw "agentguard_config_hmac_key_required_in_production"
# exit code: 1
```

### 1.5 키 로테이션 정책

| 항목 | 권장 |
|---|---|
| 주기 | 90일 |
| 절차 | 새 키 환경변수 추가 → graceful restart → 구 키 제거 |
| 진행 중 토큰 영향 | 키 교체 시 AGENTGUARD_TEST_MODE 토큰 자동 invalidate (의도된 동작) |
| 키 저장소 | HSM / KMS (AWS Secrets Manager, GCP Secret Manager, Vault) 권장 |

### 1.6 비-production 환경 (개발 / test)

- `NODE_ENV !== 'production'` (즉 `development` / `test`): HMAC_KEY 미설정 허용 (warning 로그 없음, silent)
- 단, `AGENTGUARD_ENV_FILE` 사용 시는 **항상 필요** (C1 통합 검사)

## 2. AGENTGUARD_ENV_FILE 사용 제한 (test 환경 setup 변경)

### 2.1 변경 사항

PR #43 이전:
```bash
# 이렇게만 하면 동작
NODE_ENV=test AGENTGUARD_ENV_FILE=/tmp/test.env node ...
```

PR #43 이후:
```bash
# valid HMAC token도 함께 필요
NODE_ENV=test \
AGENTGUARD_CONFIG_HMAC_KEY=<test_key> \
AGENTGUARD_ENV_FILE=/tmp/test.env \
AGENTGUARD_TEST_MODE=$(node -e "
  const { generateTestMode } = require('./packages/server/dist/auth/test-mode.js');
  console.log(generateTestMode(Date.now() + 60_000));
") \
  node ...
```

### 2.2 테스트 코드 패턴

테스트 setup 함수 (vitest/jest 등에 적용):
```typescript
import { generateTestMode } from '../auth/test-mode.js'

// beforeAll
process.env.AGENTGUARD_CONFIG_HMAC_KEY = require('crypto').randomBytes(32).toString('hex')
process.env.NODE_ENV = 'test'

// 각 test에서 env-file override 필요할 때
process.env.AGENTGUARD_ENV_FILE = '/tmp/test.env'
process.env.AGENTGUARD_TEST_MODE = generateTestMode(Date.now() + 60_000)
```

### 2.3 보안 근거 (DeepSeek R4 NEW CRITICAL 차단)

이전 결함 (CVE-class):
- `NODE_ENV=test` + `AGENTGUARD_ENV_FILE=<malicious>`만으로 production 우회
- supply-chain env injection (docker/k8s) 통한 token theft 경로

PR #43 적용 후:
- `AGENTGUARD_CONFIG_HMAC_KEY`는 별도 secret manager로 보호 (token 파생 ❌)
- `AGENTGUARD_TEST_MODE` token은 boot-epoch + TTL + HMAC-SHA256 → 재현·예측 불가

## 3. Cluster mode 차단 (P4 M6)

### 3.1 변경 사항

PR #43에서 `assertSingleInstance()` boot 직후 호출. 다음 환경에서 즉시 throw:
- `cluster.fork()` 로 spawn된 worker process
- `worker_threads` 의 worker
- `child_process.fork()` 로 spawn된 child (process.send 존재)

### 3.2 영향받는 배포

| 배포 패턴 | 영향 | 조치 |
|---|---|---|
| 단일 process (정상) | 영향 없음 | — |
| PM2 cluster mode | **모든 worker boot abort** | exec_mode=fork로 변경 (single instance) |
| Docker swarm replicas | 영향 없음 (각 container가 별도 process) | — |
| Kubernetes Deployment replicas > 1 | 영향 없음 (각 pod가 별도 process) | — |
| Node.js cluster module 사용 | **boot abort** | cluster mode 제거, 단일 process 또는 별도 pod scaling |

### 3.3 향후 multi-process 지원

별건 CSR로 분리됨 (Redis SETNX 또는 PostgreSQL advisory lock 도입 시).

## 4. Audit DB Append-Only Flag (P7 H3)

### 4.1 변경 사항

`GIJUN_DB_PATH` 설정 시 boot 직후 OS append-only flag 적용:
- **macOS**: `chflags uappnd <path>` (user-level, no sudo)
- **Linux**: `chattr +a <path>` (root 또는 CAP_LINUX_IMMUTABLE)

production에서 실패 시 boot abort. non-prod에서는 warning 후 continue.

### 4.2 Linux 배포 시 권한 설정

```bash
# Option A: 권한 부여 (1회)
setcap cap_linux_immutable+ep $(which node)

# Option B: agentguard 사용자에 CAP 추가 (systemd)
# /etc/systemd/system/agentguard.service
[Service]
AmbientCapabilities=CAP_LINUX_IMMUTABLE

# Option C: root로 실행 (비권장 — 다른 보안 위험)
```

### 4.3 macOS 배포 시
- 별도 권한 설정 불필요 (`chflags uappnd`는 user-level)

### 4.4 영향: SQLite WAL mode 호환

audit_events.db는 SQLite WAL mode 사용. append-only flag 적용 후에도:
- WAL 파일 (`.db-wal`) write — 영향 없음 (flag는 main DB 파일에만 적용)
- WAL checkpoint 시 main DB write — append만 발생하면 정상 동작
- main DB 파일 삭제·truncate — flag로 차단 (의도된 보안 효과)

운영자 주의:
- DB 파일 삭제 또는 재생성 시 `chflags nouappnd` 또는 `chattr -a` 먼저 실행 필요
- backup tool은 read-only access만 사용 (cp / rsync 정상 동작)

## 5. 롤백 절차

### 5.1 PR #43 revert
```bash
git revert <pr-43-commit-range>
# 또는 main에서 PR #42 base로 reset
git reset --hard 5507969
```

### 5.2 환경변수 정리
```bash
# 모두 제거 가능
unset AGENTGUARD_CONFIG_HMAC_KEY
unset AGENTGUARD_TEST_MODE
```

### 5.3 OS flag 해제
```bash
# macOS
chflags nouappnd <audit-db-path>

# Linux
chattr -a <audit-db-path>
```

### 5.4 audit log hash-chain 호환

- 기존 PR #42 base의 hash-chain (chain.ts + verify-chain.ts)은 그대로 유지
- 롤백 후에도 verify 가능 (algorithm 변경 없음)
- 단, append-only flag 해제 후에는 OS-level prevention 사라짐 (application-level hash-chain만 남음)

## 6. References

- 출처 DA: `/tmp/da-chain-1779432199/final.txt` (CSR #771 4-AI Tier 1 security)
- Threat model: `docs/threat-model-CSR-775.md`
- Plan: `prompt_plan.md` (LOCAL `.gitignore`, working plan)
- 관련 CSR: #771 (DA verification), #775 (본 PR), #777 (carry-forward hardening), #778 (carry-forward DA infra)
- CWE 매핑: §threat-model-CSR-775.md §7
