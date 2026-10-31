# Architecture

## 한눈에

```
 방문자 브라우저 (problem-child.tistory.com)
 ┌──────────────────────────────────────────────┐
 │ 티스토리 스킨 (skin.html + style.css)           │
 │  images/script.js = 테마/목차/맨위로 + 챗봇 위젯    │
 └───────────────┬──────────────────────────────┘
                 │ fetch (CORS: 블로그 도메인만)
                 ▼
 Cloudflare Worker  tistory-ai-assistant-api.youngs5440.workers.dev
 ┌──────────────────────────────────────────────┐
 │ /api/v1/*  공개 API (IP당 분당 20회, 캐시 10분)    │
 │ /admin/*   관리자 API (Bearer ADMIN_TOKEN)     │
 │ cron */10  수집 + 0건 로그 정리                 │
 └──┬──────────┬──────────┬──────────┬──────────┘
    ▼          ▼          ▼          ▼
   D1      Vectorize   Workers AI   티스토리 (sitemap.xml, 글 페이지)
 (posts,   (청크 벡터   (bge-m3 임베딩)
  chunks,   1024차원)
  FTS, docs,
  misses)

 GitHub (juniel1299/blog) ── main 머지 ──▶ Actions: 검사 → D1 마이그레이션/seed → wrangler deploy
```

## 구성 요소

| 구성 | 위치 | 역할 |
|---|---|---|
| 스킨 | `skin/tistory/skin.html`, `skin/src/styles/` | 티스토리 치환자 템플릿 + 디자인. 빌드 시 그대로 복사 ([skin.md](skin.md)) |
| 스킨 스크립트 | `skin/src/scripts/` | 테마 전환, 목차, 맨 위로, 읽기 진행바 |
| 챗봇 위젯 | `skin/src/widget/` | React 19. `#ai-assistant`에 한 번만 마운트, `data-api-base`로 API 주소 받음 |
| 공개 API | `worker/src/api.js` | 검색, 답변, 최근 글, 비슷한 글, 시리즈, 관련 문서, 피드백 ([api-contract.md](api-contract.md)) |
| 답변 모드 | `worker/src/answer.js` | 검색 상위 3개 글을 근거로 Workers AI가 출처 번호 붙은 짧은 답 ([ADR 0008](adr/0008-answer-mode-workers-ai.md)) |
| 검색 | `worker/src/search/` | 질문 해석, 키워드+의미 검색, RRF, 미리보기 ([rag-design.md](rag-design.md)) |
| 목록/추천 | `worker/src/posts.js` | 최근 글, 비슷한 글, 카드 생성 |
| 관련 문서 | `worker/src/docs.js` | 큐레이션 링크와 글 태그/카테고리/제목 매칭 |
| 수집 | `worker/src/ingest/` | 사이트맵 비교 → 글 추출 → 청크 → 임베딩 → 저장 |
| 관리자 | `worker/src/admin.js` | 수동 수집, 추출 미리보기, 점수 디버그, 0건 질문 |
| 0건 로그 | `worker/src/misses.js` | 결과 없는 질문 텍스트만 저장, 90일 보관 |
| Search Console | `worker/src/gsc.js` | 서비스 계정 JWT(WebCrypto 서명)로 구글 검색어·노출·순위를 매일 06:00 KST에 수집, 대시보드·주간 리포트에 표시 |
| 노션 주간 리포트 | `worker/src/notion.js` | 주간 인사이트를 노션 페이지(주마다 하위 페이지)로 전송, 같은 주는 같은 페이지를 다시 씀 |
| 인사이트 분석 | `worker/src/topics.js`, `worker/src/weekly.js` | 질문 주제 묶기, 다음 글 후보(콘텐츠 공백), 월요일 09:00 KST 주간 AI 요약 |
| 인사이트 대시보드 | `worker/public/dashboard/`, `worker/src/insights.js` | Workers Static Assets로 `/dashboard/` 제공, 데이터는 `GET /admin/insights` (관리자 토큰) |
| 방문·클릭 수집 | `worker/src/events.js`, `skin/src/scripts/analytics.js` | 조회·읽은 깊이 비콘, 카드 클릭, 결과 있는 질문 (3차 대시보드용, 90일) |
| 데이터 | `worker/migrations/`, `worker/seed/` | D1 스키마, 공식 문서 seed ([data-model.md](data-model.md)) |
| 평가 | `worker/eval/` | 검색 품질 평가 세트와 실행기 |
| CI/CD | `.github/workflows/ci.yml` | 검사(모든 push/PR), 배포(main) ([operations.md](operations.md)) |

## 주요 흐름

**질문 → 결과 카드**
1. 위젯이 `POST /api/v1/search {query, offset}`
2. Worker: 의도 판단(최근 글 / 카테고리 범위 / 일반 검색) → 결과 6개까지 계산해 캐시 → 3개씩 응답
3. 위젯: 한 줄 미리보기 + 제목(새 탭) + [관련 문서] 카드, 남으면 [더 보기]

**질문 → 답변**: 질문형 입력이면 `POST /api/v1/answer` → 검색 상위 3개 글 + Workers AI → 출처 `[n]`이 붙은 2~4문장 + 출처 카드. 답이 없으면 카드만, 실패하면 일반 검색

**관련 문서**: 카드의 버튼 → `GET /api/v1/posts/:id/docs` → 큐레이션 링크 최대 3개 (LLM이 만든 링크 없음)

**챗봇 열기**: 글 본문 페이지(`/123`)면 `GET /api/v1/posts/123/similar`, 아니면 `GET /api/v1/posts/recent` + 예시 질문 버튼

**수집**: 10분마다 sitemap의 `lastmod`와 D1을 비교해 바뀐 글 최대 3개 재색인, 사라진 글 삭제 ([rag-design.md](rag-design.md#수집))

## 결정 기록

| ADR | 결정 |
|---|---|
| [0001](adr/0001-cloudflare-serverless.md) | FastAPI/Postgres/Docker 대신 Cloudflare 서버리스 |
| [0002](adr/0002-docs-as-curated-links.md) | 공식 문서는 벡터화하지 않고 큐레이션 링크 |
| [0003](adr/0003-cron-ingestion-in-worker.md) | 수집은 Worker Cron에서 3개씩 증분 |
| [0004](adr/0004-extractive-preview.md) | 한 줄 미리보기는 추출식 (LLM 요약 보류) |
| [0005](adr/0005-hybrid-search-thresholds.md) | 하이브리드 검색 + 실데이터로 맞춘 임계값 |
| [0006](adr/0006-skin-in-place-edit.md) | 스킨은 기존 스킨을 보관 후 편집 화면에서 교체 |
| [0007](adr/0007-ci-auto-deploy.md) | Worker는 main 머지 시 자동 배포, 스킨은 수동 |
| [0008](adr/0008-answer-mode-workers-ai.md) | Q&A 답변 모드는 Workers AI Gemma 4 (생각 끔), 실패 시 검색 |
