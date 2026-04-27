[English](./README.md) · [한국어](./README.ko.md)

# gijun-ai

> **기준을 세우고, 검증하며, 학습한다.**
>
> 1인용 AI 에이전트 audit/검증 워크벤치 — 중요한 것을 바꾸는 모든 Claude/LLM 세션을 감사·검증·학습한다.

![version](https://img.shields.io/github/package-json/v/aniboy2k-gif/gijun-AI?color=blue)
![license](https://img.shields.io/badge/license-MIT-green)
![node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)
![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A59-orange)
![status](https://img.shields.io/badge/status-v0.1%20alpha-yellow)

**Status: 개인용 1인 도구 — 프로덕션 의존성으로 사용 불가.** HITL 게이트는 1인 개발자를 위한 자기 승인(self-approval) 속도 제한 장치이지 다인 거버넌스가 아닙니다. 팀 모드·RBAC·다중 사용자 separation-of-duties가 필요하면 프로젝트를 포크하세요.

---

## gijun-ai가 필요한 이유

Claude Max 또는 유사한 에이전트 티어를 사용하는 개인 개발자들은 진짜 중요한 일을 합니다 — 코드를 릴리스하고, 프로덕션을 건드리고, 정책 문서를 수정합니다. 그러나 에이전트의 추론·승인·비용 흔적은 세션이 끝나는 순간 모두 사라집니다. 분쟁 시 믿을 만한 감사 로그도 없고, 어설프게 검증된 아이디어의 실행을 막을 게이트도 없으며, `/clear` 이후에도 남는 메모리도 없습니다.

**gijun-ai**는 사용자와 에이전트 사이에 위치하는 로컬 우선 audit/검증 레이어입니다:

- **Audit** — 모든 결정을 append-only SHA-256 해시 체인으로 기록하여 redaction 이후에도 무결성 유지
- **Verify** — 중요한 작업은 실행 전에 4축 HITL(Human-In-The-Loop) 게이트를 통과해야 합니다
- **Learn** — 인시던트로부터 학습해 후보 패턴을 검색 가능한 지식 베이스로 승격합니다
- **Bound** — 강제 집행 없이 advisory budget 정책으로 호출자에게 중단 시점을 알려줍니다
- **Expose** — 위 모든 것을 REST API, Model Context Protocol(MCP) 서버, 로컬 CLI로 노출합니다

세 개의 Node 패키지가 `127.0.0.1`의 단일 SQLite 파일을 대상으로 실행됩니다. 클라우드 종속성 없음, 팀 모드 없음, 인증 공급자 없음 — 오직 에이전트가 무엇을 했는지에 대한 규율 있는 기록, 그리고 잘못된 일을 하기 전에 멈추는 게이트만 있습니다.

---

## 목차

1. [빠른 시작](#빠른-시작)
2. [아키텍처 계약](#아키텍처-계약)
3. [모듈 구성](#모듈-구성)
4. [REST API 레퍼런스](#rest-api-레퍼런스)
5. [MCP 도구 레퍼런스](#mcp-도구-레퍼런스)
6. [보안 모델](#보안-모델)
7. [OWASP ASI 매핑](#owasp-asi-매핑)
8. [알려진 제한](#알려진-제한)
9. [로드맵](#로드맵)
10. [개발](#개발)
11. [라이선스](#라이선스)

---

## 빠른 시작

### 사전 요구 사항

- Node.js ≥ 22 (네이티브 `node:sqlite` 사용)
- pnpm ≥ 9
- macOS / Linux (Windows 미검증)

### 설치

```bash
git clone https://github.com/aniboy2k-gif/gijun-AI.git
cd gijun-AI
pnpm install
pnpm build
```

### 토큰 생성 및 서버 시작

```bash
# 32바이트 16진수 토큰 — fail-closed, 필수
export AGENTGUARD_TOKEN="$(openssl rand -hex 32)"
export AGENTGUARD_DB_PATH="$(pwd)/gijun.db"

node packages/server/dist/server.js
# → [agentguard] server listening on http://127.0.0.1:3456
```

### 동작 확인

```bash
curl -s http://127.0.0.1:3456/health
# → {"ok":true,"version":"<package.json version>"}  # 예: "0.1.1"

curl -s -X POST http://127.0.0.1:3456/tasks \
  -H "X-AgentGuard-Token: $AGENTGUARD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"First task","complexity":"trivial"}'
# → {"id":1}
```

### MCP 서버로 연결

Claude Code `.mcp.json` 에:

```json
{
  "mcpServers": {
    "gijun-ai": {
      "command": "node",
      "args": ["/absolute/path/to/gijun-ai/packages/mcp-server/dist/index.js"],
      "env": {
        "AGENTGUARD_TOKEN": "<REST API와 동일한 토큰>",
        "AGENTGUARD_SERVER_URL": "http://127.0.0.1:3456"
      }
    }
  }
}
```

또는 HTTP 모드로 실행:

```bash
AGENTGUARD_MCP_TRANSPORT=http \
AGENTGUARD_MCP_PORT=3457 \
AGENTGUARD_MCP_TOKEN="$(openssl rand -hex 32)" \
AGENTGUARD_TOKEN="$AGENTGUARD_TOKEN" \
  node packages/mcp-server/dist/index.js
```

---

## 아키텍처 계약 및 검증 상태

구현이 스스로 지키는 6개의 강한 규칙입니다. 모든 신규 기능은 이 규칙들을 통과해야 합니다.

| # | 계약 | 강제 방식 | 상태 |
|---|------|----------|:----:|
| 1 | **Append-only 감사** — 기존 감사 행은 절대 수정되지 않고 새 행만 추가 | `audit_events`에 SQL `UPDATE`/`DELETE` 없음; `POST /audit/integrity-check`로 해시 체인 검증 | `[passed]` |
| 2 | **전체 마이그레이션 체인 사전 검증** — 알려진 모든 마이그레이션이 순서대로 적용되기 전까지 서버는 요청을 받지 않음 | `server.ts`의 `app.listen()` 전 `assertSchemaChain([...])` 호출 | `[passed]` |
| 3 | **콘텐츠 주소 기반 redaction** — redaction이 `payload`를 교체해도 `original_hash`가 유지되어 takedown 후에도 무결성 보존 | `audit_events.original_hash` 컬럼 + 변경 가능한 payload가 아닌 `original_hash`로 체인 연결 | `[passed]` |
| 4 | **Fail-closed 인증** — `AGENTGUARD_TOKEN` 미설정 시 서버 시작 단계에서 종료; 모든 경로가 헤더 요구 | `server.ts`의 시작 가드 + `/health`를 제외한 모든 라우터의 `requireToken` 미들웨어 | `[pending E2E]` |
| 5 | **로컬 전용 바인딩** — 대기 주소는 `127.0.0.1`, 공개 인터페이스 불가 | `server.ts` 및 `transports.ts`의 하드코딩된 `HOST` | `[unverified]` |
| 6 | **비가역 작업 전 HITL 게이트** — 1인 자기 승인을 거쳐야 작업이 `done` 상태로 전이 가능 | `hitl/gate.ts`의 `evaluateHitl()` + `POST /tasks/:id/hitl-approve` + `updateTaskStatus`의 상태 전이 가드 (v0.1.1) | `[passed]` (v0.1.1) |

---

## 모듈 구성

`@gijun-ai/core`의 8개 모듈. 각각은 좁은 공개 인터페이스와 비공개 스키마를 가진 상태 기계입니다.

### 1. Audit — 해시 링크 장부

모든 이벤트는 `(prev_chain_hash, content_hash)`에 대해 SHA-256 체인됩니다. `content_hash`는 redact 가능한 `payload`가 아니라 `original_hash`에서 파생됩니다. 즉, 정보공개청구 대응을 위해 `payload`를 공란으로 만드는 삭제 요청이 발생해도 체인은 **깨지지 않습니다** — `verifyChain()`이 `original_hash`에 대해 검증하므로 `valid: true`를 유지합니다.

주요 파일: `packages/core/src/audit/service.ts`

### 2. Task + HITL Gate — 4축 트리거

작업은 `complexity` 축(`trivial | standard | complex | critical`)을 가집니다. HITL 평가는 네 가지 차원을 결합합니다: **irreversibility**, **blast_radius**, **complexity**, **verify_fail**. 어느 한 축이라도 임계치를 넘으면 작업은 `hitl_wait` 상태로 전환됩니다. 운영자(= 당신 — gijun-ai는 1인용)가 직접 `POST /tasks/:id/hitl-approve`를 호출해야 비가역 실행이 진행됩니다. 이는 잊혀진 폭주 에이전트에 대한 **자기 승인 속도 제한** 장치이지 다인 거버넌스가 아닙니다. separation-of-duties가 필요하면 포크가 필수입니다.

주요 파일: `packages/core/src/task/service.ts`, `packages/core/src/hitl/gate.ts`

### 3. Playbook — 절차적 기억

에이전트가 행동 전 참조할 수 있도록 사람이 작성한 절차들입니다. slug(고유) 또는 숫자 id로 식별되며 `updated_at`로 버전 관리됩니다. list/search 기능은 v0.2로 이연.

주요 파일: `packages/core/src/playbook/service.ts`

### 4. Knowledge — 4계층 FTS5

SQLite의 FTS5와 트라이그램 토크나이저로 `knowledge_items`에 대한 전문 검색을 수행합니다. 4개의 신뢰도 계층: `global | project | incident | candidate`. 후보는 감사 이벤트도 함께 기록하는 원자적 트랜잭션을 통해 incident 계층으로 승격 가능합니다.

주요 파일: `packages/core/src/knowledge/retriever.ts`

### 5. Incident — 패턴 승격

AI가 유발한 장애를 보고하고, 유사 보고가 누적되면 운영자가 명시적으로 승인할 때 후보 패턴을 재사용 가능한 incident 계층으로 승격합니다.

주요 파일: `packages/core/src/incident/service.ts`

### 6. Policy Engine — standard | budget 디스크리미네이티드 유니온

두 가지 정책 종류, 한 개의 테이블, 한 개의 Zod `discriminatedUnion`:

- **Standard** 정책: `toolName × actionType × resource`로 스코프된 고전적 allow/deny에 선택적 `rate_limit` 추가
- **Budget** 정책: `CostLimitConditions { period, usd_limit, warning_threshold, critical_threshold }`를 사용하는 비용 상한

선택은 결정론적입니다: 가장 구체적인 정책이 우선, `priority DESC`가 타이브레이커, 그 다음 `created_at DESC`.

주요 파일: `packages/core/src/policy/engine.ts`

### 7. Verify Strategy — 샘플링 모드

주어진 작업 단계에 보조 검증이 필요한지 결정합니다. 결정론적 샘플링(해시 기반)으로 적대적 우회를 방지합니다.

주요 파일: `packages/core/src/verify/strategy.ts`

### 8. Tracer + Cost Budget — 7상태 advisory

단계별 토큰/지연/비용 trace를 기록합니다. `checkBudget(scope)`는 다음 7가지 advisory 상태 중 하나를 반환합니다:

| status | 의미 |
|--------|------|
| `no_policy` | 매칭되는 budget 정책 없음 |
| `no_cost_data` | 정책은 있으나 해당 기간에 trace 없음 |
| `under_budget` | 경고 임계치 미만 |
| `warning` | warning_threshold(기본 0.8) 이상 |
| `critical` | critical_threshold(기본 0.95) 이상 |
| `over_budget` | limit 이상 — 호출자가 결정 |
| `invalid` | 정책 JSON이 스키마 검증 실패 |

`warning | critical | over_budget | invalid`는 감사 로그에 자동 추가됩니다. **함수는 강제하지 않으며**, 호출자(에이전트, 정책 평가기, 사람)가 조치를 결정합니다. 지원 기간: `1h | 24h | 7d | 30d | mtd` (월 누계, UTC 기준).

주요 파일: `packages/core/src/tracer/service.ts`

---

## REST API 레퍼런스

`GET /health`를 제외한 모든 경로는 `X-AgentGuard-Token` 헤더가 필요합니다. 기본 URL: `http://127.0.0.1:3456`.

### Health

| Method | Path | Auth | 설명 |
|--------|------|:----:|------|
| GET | `/health` | — | 생존 확인 + 버전. |

### `/tasks` — 추적 작업

| Method | Path | Auth | 설명 |
|--------|------|:----:|------|
| GET | `/tasks` | ✓ | 작업 목록 (필터: `project`, `status`, `limit`). |
| POST | `/tasks` | ✓ | 작업 생성. Body: `{ title, complexity, description?, project?, tags? }`. |
| GET | `/tasks/:id` | ✓ | 단일 작업 조회. |
| PATCH | `/tasks/:id/status` | ✓ | 상태 전이 (`pending | in_progress | hitl_wait | done | cancelled`). |
| POST | `/tasks/:id/steps` | ✓ | AI 단계(prompt/response/cost/latency) 추가. |
| POST | `/tasks/:id/hitl-approve` | ✓ | HITL 게이트 작업에 대한 인간 승인 기록. |

### `/audit` — append-only 장부

| Method | Path | Auth | 설명 |
|--------|------|:----:|------|
| POST | `/audit` | ✓ | 감사 이벤트 추가. |
| GET | `/audit?n=N` | ✓ | 최근 N개 이벤트 (기본 20, 최대 200). |
| GET | `/audit/integrity-check` | ✓ | 해시 체인 재계산; `{ valid, total, broken }` 반환. |

### `/knowledge` — 4계층 저장소

| Method | Path | Auth | 설명 |
|--------|------|:----:|------|
| GET | `/knowledge` | ✓ | 항목 목록 (`layer`, `project` 필터). |
| POST | `/knowledge` | ✓ | 특정 계층에 지식 항목 생성. |
| POST | `/knowledge/search` | ✓ | FTS5 검색. Body: `{ query, limit?, project? }`. |
| POST | `/knowledge/:id/promote` | ✓ | 후보를 incident 계층으로 승격 (감사 포함 원자적). |

### `/playbooks`

| Method | Path | Auth | 설명 |
|--------|------|:----:|------|
| GET | `/playbooks` | ✓ | 플레이북 목록. |
| POST | `/playbooks` | ✓ | 플레이북 생성. |
| GET | `/playbooks/slug/:slug` | ✓ | slug로 조회. |
| GET | `/playbooks/:id` | ✓ | id로 조회. |
| PATCH | `/playbooks/:id` | ✓ | 내용/메타데이터 수정. |

### `/incidents`

| Method | Path | Auth | 설명 |
|--------|------|:----:|------|
| GET | `/incidents` | ✓ | 인시던트 목록. |
| POST | `/incidents` | ✓ | 인시던트 보고. |
| GET | `/incidents/patterns` | ✓ | 승격 후보 패턴 목록. |
| POST | `/incidents/patterns/:hash/approve` | ✓ | 후보 패턴 승인. |

### `/policies`

| Method | Path | Auth | 설명 |
|--------|------|:----:|------|
| GET | `/policies` | ✓ | 모든 정책 목록. |
| POST | `/policies` | ✓ | standard 또는 budget 정책 생성 (`policyKind`로 구분). |
| POST | `/policies/evaluate` | ✓ | `{ toolName, actionType, resource }`를 활성 standard 정책들에 대해 평가. |
| POST | `/policies/:id/activate` | ✓ | 활성화. |
| POST | `/policies/:id/deactivate` | ✓ | 비활성화. |

### `/traces`

| Method | Path | Auth | 설명 |
|--------|------|:----:|------|
| POST | `/traces` | ✓ | trace 행 기록 (토큰, 비용, 지연, 모델). |
| GET | `/traces/summary?period=P` | ✓ | `P ∈ {1h, 24h, 7d, 30d, mtd}` 기간 집계. |

### `/budget`

| Method | Path | Auth | 설명 |
|--------|------|:----:|------|
| POST | `/budget/check` | ✓ | `{ toolName?, resource? }`에 대한 advisory 예산 상태. 위의 7상태 표 참조. |

### `/verifications`

| Method | Path | Auth | 설명 |
|--------|------|:----:|------|
| POST | `/verifications` | ✓ | 단계에 대한 검증 결과 기록. |

### `/hitl`

| Method | Path | Auth | 설명 |
|--------|------|:----:|------|
| POST | `/hitl/evaluate` | ✓ | 작업 맥락을 4개 HITL 축으로 평가; 트리거 반환. |

### `/preflight`

| Method | Path | Auth | 설명 |
|--------|------|:----:|------|
| POST | `/preflight` | ✓ | 부작용 없이 정책 + HITL 평가를 결합한 원샷 진단. |

**합계**: 34개 엔드포인트 (1개 health + 33개 인증 필요).

---

## MCP 도구 레퍼런스

REST 인터페이스에 1:1 매핑된 17개 도구. 명명 규칙: `get_/list_/search_/tail_/verify_/check_` = READ, 그 외는 WRITE. 모든 도구는 원자적 트랜잭션 내에서 서버 측에서 재검증됩니다 — `preflight_check`와 `check_budget` 결과는 advisory.

### READ (9)

| 도구 | 대응 경로 | 목적 |
|------|----------|------|
| `list_tasks` | `GET /tasks` | 추적 작업 목록. |
| `get_task` | `GET /tasks/:id` | 단일 작업 조회. |
| `tail_audit` | `GET /audit?n=N` | 최근 N개 감사 이벤트. |
| `verify_audit_integrity` | `GET /audit/integrity-check` | 깨진 해시 링크 보고. |
| `search_knowledge` | `POST /knowledge/search` | FTS5 검색. |
| `get_playbook` | `GET /playbooks/:id` 또는 `…/slug/:slug` | id 또는 slug로 플레이북 하나. |
| `get_cost_summary` | `GET /traces/summary` | 비용 + 지연 집계. |
| `check_budget` | `POST /budget/check` | advisory 예산 상태 (7상태). |
| `preflight_check` | `POST /preflight` | 정책 + HITL 진단. |

### WRITE (8)

| 도구 | 대응 경로 | 목적 |
|------|----------|------|
| `create_task` | `POST /tasks` | 작업 생성. |
| `update_task_status` | `PATCH /tasks/:id/status` | 상태 전이. |
| `add_task_step` | `POST /tasks/:id/steps` | AI 단계 기록. |
| `approve_hitl` | `POST /tasks/:id/hitl-approve` | 인간 승인. |
| `append_audit` | `POST /audit` | 감사 이벤트 기록. |
| `create_knowledge` | `POST /knowledge` | 지식 항목 추가. |
| `promote_knowledge` | `POST /knowledge/:id/promote` | 후보 → incident. |
| `report_incident` | `POST /incidents` | 인시던트 보고. |

v0.1에서 제외 (REST로만 사용): GET 외의 playbook CRUD, incident 패턴 승격, 원시 policy CRUD, `POST /traces`, `POST /verifications`. 이유: 큐레이션 영역이지 일상적 에이전트 동작이 아닙니다.

---

## 보안 모델

- **Fail-closed 기동** — `AGENTGUARD_TOKEN` 부재 시 서버는 exit code 1로 종료. 기본 토큰 없음, 개발용 우회 없음.
- **로컬 전용 바인딩** — `server.ts`에서 `HOST = '127.0.0.1'`. 설정 옵션 아님.
- **두 개 토큰 분리** — `AGENTGUARD_TOKEN`(REST)과 `AGENTGUARD_MCP_TOKEN`(MCP HTTP)이 독립적이므로 MCP 계층 유출이 REST 직접 접근을 의미하지 않음.
- **SHA-256 해시 체인** — `content_hash = sha256(original_hash + canonical(event))`; `chain_hash = sha256(prev_chain_hash + content_hash)`. canonical JSON은 재귀적 키 정렬을 사용 (`packages/core/src/audit/chain.ts:5-19` 참조); **RFC 8785 JCS는 미준수** — 숫자·유니코드 정규화 없음. 키 순서만 다른 동일 논리 JSON(중첩 객체 포함)에서 재현 가능하나, `1.0` vs `1` 또는 NFC/NFD 유니코드 동등성은 보장하지 않습니다.
- **Redaction 독립 무결성** — `original_hash`는 삽입 시점에 동결; 체인 검증이 이를 사용. 컴플라이언스를 위해 `payload`를 공란화해도 체인 유지.
- **Append-only** — 코드베이스 전체에 `audit_events`에 대한 DELETE·UPDATE 없음.
- **단일 연결 + WAL** — node:sqlite와 `journal_mode=WAL`; `beginAudit*` / `commit` 헬퍼가 promote/HITL-approve 흐름을 원자 트랜잭션으로 처리.
- **스키마 체인 사전 검증** — 서버는 `schema_migrations`가 예상된 순서(`001_initial → 002_original_hash → 003_original_hash_type → 004_cost_budget → 005_policy_eval_index`)로 모든 마이그레이션을 나열하지 않으면 시작을 거부.

---

## OWASP ASI 매핑

OWASP의 Agentic Security Initiative top-10을 본 코드베이스에 매핑. **1인 개발자 로컬 인스턴스 범위**로 국한된 대응이며, ASI 커버리지는 부분적이고 인증이 아닌 설계 목표임을 명시합니다.

### 검증 상태 요약

각 ASI 항목에 검증 라벨을 붙여 독자가 어떤 주장이 테스트로 보증되고 어떤 주장이 설계 의도인지 식별할 수 있도록 합니다.

| 항목 | 상태 | 비고 |
|------|:----:|------|
| ASI01 Prompt Injection | `[passed]` | HITL 게이트 집행 (`hitl-enforcement.test.ts`) + 정책 엔진 `deny` 효과 |
| ASI02 Insecure Output Handling | `[passed]` | SHA-256 감사 체인, `audit-chain.test.ts`, `chain.test.ts` |
| ASI03 Training Data Poisoning | `[out of scope]` | 업스트림 모델 위생은 제공자 책임 |
| ASI04 Model DoS | `[pending E2E]` | rate_limit advisory 검사 + 예산 advisory 상태 — **end-to-end 차단 테스트 없음** (v0.2 로드맵) |
| ASI05 Supply Chain | `[pending]` | `pnpm-lock.yaml` 고정, 자동 SBOM/Dependabot 아직 없음 (v0.2 로드맵) |
| ASI06 Sensitive Info Disclosure | `[passed]` | `redactPayload` + `original_hash` 기반 체인 검증 |
| ASI07 Insecure Plugin Design | `[passed]` | REST + MCP 독립 2토큰 — `middleware/auth.ts`, `transports.ts` |
| ASI08 Excessive Agency | `[passed]` (v0.1.1) | `hitl-enforcement.test.ts`, `task-atomicity.test.ts` — **v0.1.0에서는 문서화되었으나 집행되지 않음** |
| ASI09 Overreliance | `[passed]` | `preflight_check`와 `check_budget`이 advisory-only 결과 반환; 각 경로에 단위 테스트 존재 |
| ASI10 Model Theft | `[out of scope]` | 모델 가중치 미저장; prompt/response 저장 위협 모델은 호스트 물리 접근 |

**라벨 범례**:
- `[passed]` — 이 저장소의 자동 테스트가 주장을 검증함.
- `[pending E2E]` — 단위 테스트는 존재하나 주장을 종단간으로 검증하는 통합 테스트는 v0.2 로드맵.
- `[unverified]` — 해당 주장을 검증하는 테스트가 현재 없음; 소비자가 독립 검증해야 함.
- `[out of scope]` — 본 도구가 명시적으로 다루지 않음; ASI 커버리지 완결성을 위해 기재.

### ASI01 — Prompt Injection

**대응**: HITL 게이트 + 정책 엔진. 비가역적 작업으로 에스컬레이션되는 프롬프트 인젝션 시도는 단계가 `hitl_wait`에서 빠져나오기 전에 `irreversibility` 및 `blast_radius` 축에 의해 포착됨.
**모듈**: `packages/core/src/hitl/gate.ts`, `packages/core/src/policy/engine.ts`

### ASI02 — Insecure Output Handling

**대응**: 모든 감사 이벤트는 콘텐츠 주소 기반 — 하류 시스템은 자신이 본 출력이 승인된 출력과 동일함을 검증할 수 있음.
**모듈**: `packages/core/src/audit/service.ts`, `packages/core/src/audit/chain.ts`

### ASI03 — Training Data Poisoning

**범위**: gijun-ai 범위 외. 우리는 모델을 호스팅하거나 파인튜닝하지 않음 — 업스트림 모델 위생은 제공자 책임. 다만 trace별로 모델/제공자를 기록하므로 세션 전반에 걸쳐 오염 패턴을 발견할 수 있음.
**모듈**: `packages/core/src/tracer/service.ts`

### ASI04 — Model Denial of Service

**대응**: `evaluate()` 내부의 advisory rate-limit 검사 (1분 윈도우 카운트 — `packages/core/src/policy/engine.ts:157-168` 참조) + advisory 비용 예산. **실제 요청 차단은 호출자가 수행** — 서버는 HTTP 429를 자동 반환하지 않음. 호출자가 `PolicyResult = 'rate_limited'` 결과를 읽고 판단합니다. 폭주 토큰 비용에 의한 DoS는 `warning → critical → over_budget`에서 감지되어 감사 로그에 자동 표면화됨.
**모듈**: `packages/core/src/policy/engine.ts`, `packages/core/src/tracer/service.ts`

### ASI05 — Supply Chain Vulnerabilities

**범위**: 부분 대응. `pnpm-lock.yaml`을 고정하고 핀 없는 peer dependency를 피함. 자동 SBOM은 아직 없음.
**모듈**: `pnpm-lock.yaml`

### ASI06 — Sensitive Information Disclosure

**대응**: `payload` 공란화 + `original_hash` 보존을 통한 redaction. 정보 주체의 접근권 요청이 PII를 공란화해도 감사 체인은 깨지지 않음.
**모듈**: `packages/core/src/audit/service.ts` (`redactPayload`)

### ASI07 — Insecure Plugin Design

**대응**: MCP는 REST API와 별개의 토큰을 사용. 탈취된 MCP 클라이언트는 상승된 권한으로 REST 레이어를 직접 치지 못함 — 서버 측에서 재검증하는 MCP 도구를 거쳐야 함.
**모듈**: `packages/mcp-server/src/transports.ts`, `packages/server/src/middleware/auth.ts`

### ASI08 — Excessive Agency

**대응**: 4개 HITL 축 + 정책 `deny` 효과 + fail-closed 인증. 에이전트는 무엇이든 제안할 수 있지만, 비가역 실행은 위조될 수 없는 인간 승인 감사 이벤트를 필요로 함 (체인 검증이 변조된 승인을 포착).
**모듈**: `packages/core/src/hitl/gate.ts`, `packages/core/src/policy/engine.ts`

### ASI09 — Overreliance

**대응**: `preflight_check`와 `check_budget`은 명시적으로 advisory-only 결과를 반환. 호출자가 반드시 결정. 모든 비정상 결정 경로는 자동 감사되어 advisory 레이어와 인간 판단의 일치 빈도에 대한 회고 데이터를 제공.
**모듈**: `packages/server/src/routes/preflight.ts`, `packages/core/src/tracer/service.ts`

### ASI10 — Model Theft

**범위**: 범위 외. 모델 가중치를 저장하지 않음. 단계별 prompt/response는 로컬 SQLite 파일에 저장되며 그 위협 모델은 호스트에 대한 물리적 접근임.

---

## 알려진 제한

v0.1은 **단일 로컬 인스턴스를 운영하는 1인 개발자**를 위한 알파입니다. 명시적으로 이연된 것들:

- **단일 인스턴스 전용** — WAL이 있는 SQLite는 한 프로세스를 안전하게 처리; 팀 모드는 v0.3.
- **Advisory-only 예산** — `checkBudget()`은 실행을 중단시키지 않음. 하드 캡이 필요하면 호출자가 상태를 읽고 중단해야 함.
- **분산 감사 없음** — 해시 체인은 단일 파일, 복제되지 않음.
- **인증 공급자 통합 없음** — 서버당 `AGENTGUARD_TOKEN` 하나, 수동 회전.
- **부분 MCP 커버리지** — 17개 도구는 공통 경로 에이전트 동작을 다룸; 원시 정책 관리, playbook CRUD, incident 패턴 승격, `POST /traces` / `POST /verifications`는 v0.1에서 REST 전용.
- **CI 없음 / GitHub Actions 없음** — 테스트는 로컬(`pnpm test`)로만 실행. CI는 v0.2 목록에 있음.
- **Windows 미검증** — 모든 개발은 macOS Darwin 25.x에서; Linux는 작동 예상.
- **UI 없음** — 모든 것은 REST + MCP. `packages/web` 슬롯이 있으나 비어 있음.

이는 간과가 아닌 정직한 스코프 판단입니다. 하나씩 이 목록에서 빠져나갈 것입니다.

---

## 로드맵

레벨 기반 공개 상태 프레임워크와 L2 "참조 전용 공개" Definition of Done 체크리스트는 [`docs/public-status-dod.md`](./docs/public-status-dod.md)에 정리되어 있습니다. 시나리오별 적합성 매트릭스(✓ 개인 학습 / ✗ 팀 채택 등)는 [`docs/adoption-scenarios.md`](./docs/adoption-scenarios.md)를 참조하세요.

### v0.2.0 (2026-04-26 출시)

두 패치(v0.1.4 + v0.2.0)에 걸친 DA-chain 기반 안정화. 제품 동작 변경 없음, DB 마이그레이션 없음. 테스트 수 12 → 78.

- **린트** — Biome 2.4.13 + `scripts/lint.mjs` 작은 래퍼 (pnpm 10 + macOS bin shim 이슈 우회) (v0.1.4)
- **CI** — 최소 GitHub Actions 워크플로 (`.github/workflows/ci.yml`) — push/PR 시 build + test + typecheck + lint, ubuntu 에서 `Verify audit-event-schema SSOT` 단계 (v0.1.4 + v0.2.0)
- **릴리스 게이트** — `.github/workflows/release.yml` 4단계 게이트 (versioning regex / changelog / CI workflow_call / build artifact), `v*` 태그 push 트리거 (v0.1.4)
- **브랜치 + 태그 보호** — main 브랜치 보호 ruleset + `v*` 태그 보호 ruleset (v0.1.4)
- **Dependabot 그룹화** — runtime / tooling / major-updates 3 그룹, security PR 은 ungrouped (v0.1.4)
- **ASI06 SSOT** — `docs/audit-event-schema.md` (`audit_events` 컬럼 + 해시 체인 의미 + redaction 계약의 정규 스키마) + `scripts/verify-audit-schema.mjs` CI 게이트 (v0.2.0)
- **README 동기화** — `pnpm sync:readme` 가 `packages/core/src/audit/service.ts` 에서 ASI06 패턴 표 재생성 (v0.1.4)
- **Proportionality thresholds** — 외부 SSOT 포인터 `docs/proportionality-thresholds.md` 가 `~/.claude/da-tools/thresholds.json` 참조 (v0.1.4)
- **계약 테스트** — `tools-registry` (17개 MCP 도구, prefix-policy 분류) + `tools-zod-negative` (도구별 invalid-input 매트릭스) (v0.2.0)
- **WRITE 실패 매트릭스** — `appendAuditEvent` 계약을 검증하는 8 시나리오: zod throw / 정상 insert / 기본 payload / 10KB payload / 3-event 체인 / redaction-vs-originalHash 분리 / 중간 throw 복구 / `audit_events` 테이블 부재 시 fail-fast (v0.2.0)
- **감사 변조 테스트** — 3 검출 케이스 (prev_hash 변조, 중간 행 삭제, chain_hash 변조) `verifyChain()` 으로 검증 (v0.2.0)
- **Deferred RFC 메모** — `docs/v0.2-deferred-rfc-evaluation.md` 가 H6/M3/M5 (자가 검증 자동화 검토, RFC 템플릿, 게이트 매트릭스 문서) 의 비용/이익/트리거 박제 — 작업 재개 시 영수증 (v0.2.0)

### v0.3+ (장기, 이벤트 트리거)

다음 항목들은 명시적 재개 트리거가 있습니다 — 날짜가 아니라 트리거 발동 시 진행됩니다.

- **Zod 4 마이그레이션** — 구체적 마이그레이션 윈도우가 열릴 때까지 의도적 보류. Zod 4가 감사 해시 안정성에 영향을 줄 수 있는 검증 의미를 변경하기 때문에 연기됨. 마무리 근거는 PR #6 참조.
- **TypeScript 7.0 직접 마이그레이션** — TS 7.0 RC 릴리스가 트리거 (6.0 전환 릴리스 건너뛰기). PR #4 (typescript 5.9 → 6.0)는 Tier 1 DA 체인이 macOS에서 tsup 8.5.1 + TS 6.0 DTS 빌드의 `baseUrl` deprecation→error 경로 비호환을 발견한 후 닫힘.
- **redaction 정책 변경 간 감사 재현성** (`audit_events.redaction_policy_hash`, ASI06 장기). 추적: #9.
- **릴리스 아티팩트의 SBOM 및 provenance** — npm publish 전 필수; release.yml에 stub stage 있음. 추적: #8.
- **Publish 승인 게이트** (release.yml 5~6단계, 현재 stub).
- **악용 요청이 실제 차단됨을 증명하는 E2E 테스트** (ASI04, 현재 `[pending E2E]`). 추적: #7.
- **`packages/web`** 읽기 전용 대시보드 (Vite + shadcn/ui) — 슬롯 존재하지만 비어 있음.
- **MCP에 playbook CRUD** / **MCP를 통한 incident 패턴 승격** / **제자리 편집을 위한 `POST /policies/:id` PATCH**.
- **외부 보관을 위한 감사 로그 JSONL export**.
- **커스텀 HITL 축을 위한 플러그인 API**.
- **LangChain / Mastra / 기타 프레임워크 어댑터**.
- **OWASP ASI 체크의 지속적 통합**.

### 범위 외 (포크가 필요함)

gijun-ai는 1인용 도구입니다. 아래 항목은 **로드맵에 없음** — 필요하면 프로젝트를 포크하세요:

- 리더 선출 기반 감사 복제 멀티 인스턴스 모드
- 사용자별 토큰과 RBAC가 있는 팀 모드
- SaaS / 클라우드 호스팅
- 조직 단위 과금

### 로드맵에 없는 것

클라우드 호스팅 SaaS, 조직 단위 과금, 모델 호스팅, 협업 편집. 이 중 하나라도 중요하게 들린다면 gijun-ai는 맞는 도구가 아닙니다 — 단일 키보드 앞의 단일 개발자를 위해 만들어졌습니다.

---

## 개발

기여 작업은 5개 축 — 브랜딩(A) / 신뢰성(B) / 권한(C) / 운영(D) / 법무(E) — 으로 범주화합니다. 각 축의 경계 규칙은 [`docs/project-framework.md`](./docs/project-framework.md)를 참조하세요. 잘 범위가 지정된 PR은 하나의 축만 건드립니다. 라이선스·PII·외부 의존 리스크는 [`docs/legal.md`](./docs/legal.md)에 정리되어 있으며, 기여 워크플로는 [`CONTRIBUTING.md`](./CONTRIBUTING.md)를 참조하세요.

### 레이아웃

```
gijun-ai/
  migrations/                SQL 마이그레이션 (번호, 순서 중요)
  packages/
    core/                    @gijun-ai/core — 도메인 모듈, HTTP 없음
    server/                  Express REST API
    mcp-server/              MCP 서버 (STDIO + Streamable HTTP)
    web/                     (예약, v0.1에선 비어 있음)
  pnpm-workspace.yaml
  tsconfig.base.json
```

### 빌드 + 테스트

```bash
pnpm install
pnpm build                   # 세 패키지 모두 빌드 (core는 tsup, server/mcp-server는 tsc)
pnpm test                    # core 단위 테스트 실행 (node --test)
```

### 기존 DB의 감사 체인 검증

```bash
AGENTGUARD_DB_PATH="./gijun.db" pnpm audit:verify
# → { valid: true, total: 42, broken: [] }
```

### 새 DB 초기화

```bash
AGENTGUARD_DB_PATH="./gijun.db" pnpm init
```

### 기여

개인 프로젝트입니다. 이슈와 PR은 환영하지만 응답을 보장하지 않습니다. 실제로 이 위에 무언가를 출시하고 싶다면 포크하십시오 — 아키텍처는 한 자리에서 읽히도록 설계되었습니다.

---

## 라이선스

MIT — [`LICENSE`](./LICENSE) 참조.
