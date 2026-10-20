# 운영

## 환경

| 항목 | 값 |
|---|---|
| Worker | `tistory-ai-assistant-api` → https://tistory-ai-assistant-api.youngs5440.workers.dev |
| D1 | `tistory-ai-assistant` (`0c238f1e-f28a-41a3-9a7c-f5d1372fd2ad`, APAC) |
| Vectorize | `tistory-posts` (1024, cosine) |
| Cron | `*/10 * * * *` |
| 저장소 | https://github.com/juniel1299/blog (public) |
| 블로그 | https://problem-child.tistory.com |

## CI/CD (`.github/workflows/ci.yml`)

| 잡 | 언제 | 내용 |
|---|---|---|
| `check` | 모든 push, PR | `npm ci` → lint → 테스트(skin, worker) → 빌드 → 스킨 산출물/치환자 보존 확인 → Worker 번들 dry-run → 로컬 D1 마이그레이션 + seed |
| `deploy` | `main` push, `check` 통과 후 | 원격 D1 마이그레이션 → doc_links seed → `wrangler deploy` → `/health/ready` 200 확인 (최대 1분) |

- 동시 배포 방지: `concurrency: deploy-worker`
- GitHub 저장소 시크릿: `BLOG` = Cloudflare API 토큰(`cfut_…`만), `FLARE` = 계정 ID → wrangler의 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- 토큰 권한: Account 단위 Workers Scripts Edit, D1 Edit, Vectorize Edit, Account Settings Read (Zone 권한 불필요)
- 스킨은 배포하지 않는다 → [skin.md](skin.md#배포-수동)

흐름: 기능 브랜치 → GitHub Desktop Publish → PR(검사) → 머지 → 자동 배포 → (스킨 변경 시) 수동 반영.

## 비밀값

| 이름 | 위치 | 용도 |
|---|---|---|
| `ADMIN_TOKEN` | Worker secret (`wrangler secret put`), 로컬 `worker/.dev.vars`(git 제외) | 관리자 API. 32자 미만이면 관리자 API 전체가 꺼짐 |
| `BLOG`, `FLARE` | GitHub Actions 저장소 시크릿 | 배포 |

배포로 Worker secret은 바뀌지 않는다. 저장소가 public이므로 비밀값은 파일에 쓰지 않는다 ([security.md](security.md)).

## 일상 확인

```bash
# 결과 0건 질문 (토큰은 파일에서 읽어 화면에 안 남김)
curl -H "authorization: Bearer $(sed -n 's/^ADMIN_TOKEN=//p' worker/.dev.vars)" \
  "https://tistory-ai-assistant-api.youngs5440.workers.dev/admin/misses?days=30"

# 👍/👎 합계와 👎 많은 질문
curl -H "authorization: Bearer $(sed -n 's/^ADMIN_TOKEN=//p' worker/.dev.vars)" \
  "https://tistory-ai-assistant-api.youngs5440.workers.dev/admin/feedback?days=30"

# 검색 품질 (배포본 대상)
npm run eval:search -w worker
```

## 작업별 절차

| 상황 | 할 일 |
|---|---|
| 새 글 발행/수정 | 아무것도 안 해도 됨. 10분 안에 cron이 색인 (바뀐 글 3개씩) |
| 바로 색인하고 싶을 때 | `curl -X POST -H "authorization: Bearer …" <Worker>/admin/ingest` (반복 호출 가능, `remaining`이 0이 될 때까지) |
| 글 하나가 어떻게 추출되는지 | `GET /admin/preview?id=123` (쓰기 없음) |
| 검색 결과가 이상할 때 | `GET /admin/search-debug?q=…` → 키워드/의미 후보와 점수, 최종 선택 |
| 추천 결과가 이상할 때 | `GET /admin/similar-debug?id=123` |
| 검색 로직 변경 | 브랜치에서 `wrangler dev --remote --port 8788` + `EVAL_API=http://localhost:8788 npm run eval:search -w worker`로 비교 후 PR |
| 공식 문서 추가 | `worker/seed/doc_links.sql`에 행 추가 (URL 200 확인) → 머지하면 배포 때 upsert |
| 스키마 변경 | `worker/migrations/000N_*.sql` 추가 → 머지하면 배포 때 적용 |
| 관리자 토큰 교체 | `openssl rand -hex 24`를 `worker/.dev.vars`에 쓰고 `sed -n 's/^ADMIN_TOKEN=//p' worker/.dev.vars \| tr -d '\n' \| npx wrangler secret put ADMIN_TOKEN` |
| Cloudflare 토큰 노출 | Cloudflare에서 Roll → GitHub 시크릿 `BLOG` 갱신 |
| 스킨 되돌리기 | 스킨 보관함의 "한눈에 스킨 백업 2026-10-16" 적용 |
| Worker 되돌리기 | `npx wrangler rollback` (직전 버전) 또는 이전 커밋을 main에 되돌려 머지 |

`wrangler dev --remote`는 **실제 D1/Vectorize**를 쓴다. 테스트 질문이 `search_misses`에 남으면 지운다.

## 비용과 무료 한도

Workers 무료 플랜 기준 (2026-10 확인).

| 자원 | 무료 한도 | 현재 사용 |
|---|---|---|
| Workers 요청 | 하루 10만 | 방문자 질문 + cron 144회/일 |
| Workers CPU | 실행당 10ms | 수집 1회 3개로 제한 |
| Workers AI | 하루 10,000 neurons | 질문 1회 임베딩 ≈ 수십 토큰. 수집 75개 전체 ≈ 650 neurons |
| Vectorize | 저장 500만 차원, 조회 월 3,000만 차원 | 296 × 1024 ≈ 30만 차원 |
| D1 | 하루 읽기 500만 행, 쓰기 10만 행, 5GB | 작음 |

무료 플랜은 한도를 넘으면 과금되지 않고 에러가 난다 → 위젯은 "잠시 후 다시 시도해 주세요."

## 관찰

- Worker 로그: Cloudflare 대시보드 → Workers → `tistory-ai-assistant-api` → Logs (`observability.enabled`)
- 남기는 이벤트: `ingest_run`, `index_failed`, `search_failed`, `docs_failed`, `similar_failed`, `record_miss_failed` 등 (JSON 한 줄)
