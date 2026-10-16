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

데이터: `worker/seed/doc_links.sql` (41개, `url` 기준 upsert라 다시 실행해도 안전). CI 배포 때마다 적용.
seed에서 행을 지워도 DB에서 지워지지 않는다 → 삭제는 `wrangler d1 execute`로 따로.

### search_misses (0003)

| 컬럼 | 설명 |
|---|---|
| id | AUTOINCREMENT |
| query | 소문자·공백 정리한 질문 텍스트 (≤200자). **IP·식별자 없음** |
| created_at | `datetime('now')` (UTC) |

결과 0건(최근 글 요청 제외)이고 캐시에 없을 때만 기록 → 10분 안의 같은 질문은 1번. Cron이 90일 지난 행 삭제.

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
