# 데이터 모델

## D1 (`tistory-ai-assistant`, APAC)

마이그레이션: `worker/migrations/` (CI 배포 시 `wrangler d1 migrations apply DB --remote`로 자동 적용).

### app_meta (0001)

| 컬럼 | 설명 |
|---|---|
| key PK, value | `phase` 등 단순 메타데이터 |

### posts (0002)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | INTEGER PK | 티스토리 글 번호 (`https://<blog>/<id>`) |
| url | TEXT UNIQUE | |
| title, category, summary | TEXT | 제목, 카테고리 경로(예: `JavaScript/React`), og:description |
| tags | TEXT | JSON 배열 |
| published_at | TEXT | JSON-LD `datePublished` (ISO 8601) |
| source_lastmod | TEXT | sitemap `<lastmod>`. 바뀌면 재색인 |
| status | TEXT | `indexed` / `skipped`(보호글·빈 글) |
| chunk_count | INTEGER | |
| indexed_at | TEXT | |

### post_chunks (0002)

| 컬럼 | 설명 |
|---|---|
| id TEXT PK | `"<글번호>-<순번>"`. **Vectorize 벡터 id와 같다** |
| post_id → posts(id) ON DELETE CASCADE | |
| position, heading, text | 순번, 소제목, 본문 (≤1000자) |

### post_chunks_fts (0002)

FTS5 가상 테이블, `tokenize = 'trigram'` (한국어 부분 일치: "인덱스"가 "인덱스란"에 걸림. 3자 미만은 못 찾아서 LIKE로 보완).
컬럼: `chunk_id`(UNINDEXED), `post_id`(UNINDEXED), `title`, `heading`, `text`.

### doc_links (0002)

| 컬럼 | 설명 |
|---|---|
| id, technology | `java`, `spring`, `oracle-sql`, `html-css`, `javascript`, `react`, `web` |
| title, url UNIQUE, description | 표시용. URL은 seed 작성 시 HTTP 200 확인 |
| keywords | JSON 배열(소문자). 글 태그/카테고리/제목과 매칭 |

데이터: `worker/seed/doc_links.sql` (52개, `url` 기준 upsert라 다시 실행해도 안전). CI 배포 때마다 적용.
seed에서 행을 지워도 DB에서 지워지지 않는다 → 삭제는 `wrangler d1 execute`로 따로.

### search_misses (0003)

| 컬럼 | 설명 |
|---|---|
| id | AUTOINCREMENT |
| query | 소문자·공백 정리한 질문 텍스트 (≤200자). **IP·식별자 없음** |
| created_at | `datetime('now')` (UTC) |

결과 0건(최근 글 요청 제외)이고 캐시에 없을 때만 기록 → 10분 안의 같은 질문은 1번. Cron이 90일 지난 행 삭제.

### 방문·클릭·질문 기록 (0005, 3차 인사이트 대시보드용)

모두 **IP·User-Agent·쿠키·식별자 없음**, 블로그 주인(수정/삭제 링크가 보이는 상태)의 방문은 보내지 않음, Cron이 90일 지난 행 삭제.

| 테이블 | 한 행 | 컬럼 |
|---|---|---|
| `page_views` | 방문 1회 (떠날 때 `sendBeacon` 한 번) | `path`, `post_id`(글이 아니면 null), `referrer_host`(null=직접, `internal`=블로그 안), `search_engine`/`search_query`(네이버·다음·빙 등 검색어, 100자), `depth`(본문을 어디까지 봤는지 0/25/50/75/100), `seconds`(화면에 보인 시간) |
| `result_clicks` | 챗봇·헤더 검색에서 글 카드 클릭 | `post_id`, `position`(목록 순위), `source`(`chat`/`answer`/`list`/`header`), `query`(정규화한 질문, 첫 목록은 null) |
| `search_queries` | 결과가 있었던 챗봇 질문 | `query`, `mode`(search/category/recent/answer), `post_ids`(처음 보여준 글 JSON) |

결과 0건 질문은 계속 `search_misses`에만. 헤더 검색은 타이핑 중 글자라 질문으로 기록하지 않고, 클릭할 때 `result_clicks.query`로 남는다. 전체 리퍼러 URL은 저장하지 않는다.

### gsc_rows (0008)

| 컬럼 | 설명 |
|---|---|
| date, query, page | PK. Search Console의 날짜(태평양 시간), 검색어, 노출된 블로그 URL |
| post_id | URL에서 뽑은 글 번호 (`/98`, `/m/98`), 홈·카테고리는 null |
| clicks, impressions, position | 그날의 클릭, 노출, 평균 순위 |

구글이 집계한 값이라 방문자 정보 없음. 매일 최근 7일을 지우고 다시 넣음(구글이 최근 값을 계속 고침), 90일 지난 행 삭제.

### weekly_insights (0006)

| 컬럼 | 설명 |
|---|---|
| week | PK. 그 주 월요일(한국 시간) `YYYY-MM-DD` |
| summary | Workers AI가 쓴 3~5문장. 모델 실패 시 null |
| report | 요약 JSON: 지표, 상위/급상승 글, 유입, 검색어, 질문, 주제, 다음 글 후보 |
| created_at | 만든 시각 (UTC). 같은 주에 다시 만들면 덮어씀 |
| notion_page_id, notion_url | (0007) 보낸 노션 페이지. 다시 만들면 같은 페이지 내용을 지우고 다시 채움 |

집계값만 있어 개인정보 없음, 기록으로 계속 보관. 3-4에서 노션으로 보낸다.

### search_feedback (0004)

| 컬럼 | 설명 |
|---|---|
| id | AUTOINCREMENT |
| query | 소문자·공백 정리한 질문 텍스트 (≤200자). **IP·식별자 없음** |
| vote | `up` / `down` |
| post_ids | 그때 보여준 글 번호 JSON 배열 (1~3개) |
| created_at | `datetime('now')` (UTC) |

채팅 검색 결과 한 페이지마다 👍/👎 한 번. Cron이 90일 지난 행 삭제.

## Vectorize (`tistory-posts`)

- 1024차원, cosine (`@cf/baai/bge-m3`)
- 벡터 id = `post_chunks.id`, metadata `{ postId }`
- 현재 296개 (무료 저장 한도 500만 차원 ≈ 4,800개 안)

## 캐시 (Workers Cache API)

| 키 | 내용 | 수명 |
|---|---|---|
| `https://search-cache.internal/v2?q=<정규화 질문>` | 검색 결과 풀(최대 6개) + mode/category | 10분 |
| `/api/v1/posts/recent`, `/:id/similar`, `/:id/docs` 응답 | `cache-control: public, max-age=600` | 10분 |

응답 형식이 바뀌면 키 버전(`v2`)을 올린다.

## 로컬 데이터

`wrangler dev`/`dev:local`의 D1은 `worker/.wrangler/state`(git 제외)에 있다. 실제 데이터 없이 시작하므로 검색 확인은 `wrangler dev --remote` 또는 배포본으로 한다.
