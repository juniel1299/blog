# RAG 설계

"RAG"라고 부르지만 답을 LLM이 생성하지는 않는다. **검색(Retrieval)으로 글을 고르고, 근거 문장을 그대로 보여준다.**
LLM은 임베딩(bge-m3)에만 쓴다. 지어낸 답이나 지어낸 링크가 나올 수 없는 구조다 ([ADR 0004](adr/0004-extractive-preview.md)).

## 수집

`worker/src/ingest/`. Cron `*/10 * * * *` 또는 `POST /admin/ingest`가 `runIngest`를 1회 실행한다.

```
1. GET {BLOG_ORIGIN}/sitemap.xml → 글 URL(/숫자) + lastmod   (sitemap.js parseSitemap)
2. D1 posts.source_lastmod와 비교 (planSync)
   - sitemap에 없는 글 → Vectorize 벡터 + D1 행 삭제 (단, sitemap이 비면 삭제 안 함)
   - 새 글/수정 글 → lastmod 최신순 최대 3개 (POSTS_PER_RUN)
3. 글 페이지 fetch → HTMLRewriter 추출 (extract.js)
   - 제목 h1.post-title, 카테고리 .post-header .chip, 태그 .post-tags a,
     요약 og:description, 작성일 JSON-LD datePublished
   - 본문 #article-body. 제외: script/style/iframe/ins/svg/button/figcaption,
     티스토리가 끼워 넣는 .another_category / .container_postbtn / .layer_post / .revenue_unit_wrap
   - h1~h4를 만나면 새 섹션 시작
4. 청크 (chunk.js): 섹션(소제목) 경계를 넘지 않고 ≤1000자, 문단 단위로 묶음. 긴 문단은 문장 끝에서 자름. 글당 ≤40개
5. 임베딩: "제목\n소제목\n본문"을 @cf/baai/bge-m3 (1024차원), 20개씩
6. Vectorize upsert (id "<글번호>-<순번>", metadata {postId}), 줄어든 청크는 deleteByIds
7. D1 batch: posts upsert, post_chunks / post_chunks_fts 교체
```

- **D1을 마지막에 쓴다**: 임베딩·Vectorize에서 실패하면 `source_lastmod`가 그대로라 다음 실행에서 다시 시도한다
- 한 번에 3개인 이유: 무료 플랜의 실행당 CPU 10ms / 서브요청 50개 ([ADR 0003](adr/0003-cron-ingestion-in-worker.md))
- 본문이 없거나(보호글) 제목이 없으면 `status = 'skipped'`로 남겨 매번 다시 가져오지 않는다
- 추출 결과는 쓰기 없이 `GET /admin/preview?id=123`으로 확인할 수 있다
- 현재 색인: 75개 글, 296개 청크 (2026-10-16)

## 검색

`worker/src/search/`. `POST /api/v1/search`.

### 1. 의도 판단 (`intent.js`)

| 질문 | 처리 |
|---|---|
| "최근 글 보여줘", "새로 올라온 글 있어?" (다른 주제어 없음) | 최신 글 목록 (`mode: recent`) |
| "리액트 카테고리에서 상태관리" | 카테고리 `react`로 범위를 좁힌 검색 (`mode: category`) |
| "자바 카테고리 글 보여줘" (카테고리 말고 주제어 없음) | 그 카테고리 최신 글 |
| 그 외 | 일반 검색 (`mode: search`) |

카테고리 매칭은 경로 단계 단위로 정확히 비교한다. `java/Spring` → `java`, `spring`; `JavaScript/React` → `javascript`, `react`; `SQL(oracle)` → `sql`, `oracle`.
그래서 "java"가 "JavaScript"에 걸리지 않는다. 한국어 별칭: 자바→java, 리액트→react, 스프링→spring, 오라클→oracle, 웹→web 등.

### 2. 질문 해석 (`query.js` parseQuery)

```
"PostgreSQL 인덱스에 대한 글 찾아줘"
 → 요청 표현 제거 ("에 대한", "글", "찾아줘")       → "PostgreSQL 인덱스"
 → 단어별 조사 제거 ("인덱스에" → "인덱스", 3자 이상만)
 → 흔한 단어 제거 (차이, 정리, 개념, 비교, 방법, vs …)
 → 음역 별칭 추가 (인덱스 → index, 뷰 → view, 리액트 → react …)
 → terms ["postgresql", "인덱스", "index"]
   ftsQuery '"postgresql" OR "인덱스" OR "index"'  (3자 이상, 따옴표로 감싸 FTS 연산자 무력화)
   likeTerms []                                    (2자 단어, 예: "조인")
```

음역 별칭은 평가에서 놓친 "머티리얼라이즈드 뷰"(글은 영어 "Materialized View") 때문에 넣었다. "자바"→"java"는 "javascript"까지 잡아서 일부러 뺐다.

### 3. 후보 수집 (`search.js`)

| 신호 | 방법 | 비고 |
|---|---|---|
| 강한 키워드 | FTS5 trigram `{title heading} : (…)` + LIKE(제목/소제목) | bm25 가중치 제목 5, 소제목 2, 본문 1 |
| 본문 키워드 | FTS5 `text : (…)` + LIKE(본문) | |
| 의미 | 질문 임베딩 → Vectorize topK 20 (카테고리 범위면 50) | cosine 점수 |

### 4. 관련도 관문 (`rank.js` selectRankings)

- 제목/소제목 키워드 일치: 항상 인정
- 의미 점수 ≥ **0.5**: 인정
- 본문에만 키워드가 있는 경우: 그 글의 의미 점수도 ≥ 0.5일 때만 (순위 보정용, 새 글을 끌어오지 않음)
- 카테고리 범위면 범위 밖 글의 후보를 모두 버린다

### 5. 병합 (`rank.js` fuseRankings)

RRF(k=60)로 세 목록을 합치고 **글당 가장 좋은 청크 1개**만 남긴다. 상위 6개(RESULT_POOL)를 10분 캐시하고 3개씩(offset 0, 3) 돌려준다 → 위젯 [더 보기].

### 6. 한 줄 미리보기 (`query.js` makeSnippet)

고른 청크에서 우선순위대로 한 줄: 질문 단어가 있는 한국어 문장 → 한국어 문장 → 질문 단어가 있는 15자 이상 줄 → 첫 줄. 코드처럼 보이는 줄(`{ } ;`, `=>`, `const …`, `SELECT …`)은 피한다. 최대 120자.

## 대화 기능

| 기능 | API | 방식 |
|---|---|---|
| 더 보기 | `POST /api/v1/search {offset: 3}` | 캐시된 6개 중 4~6번째 |
| 최근 글 | `GET /api/v1/posts/recent`, "최근 글 보여줘" | `published_at` 최신순, 미리보기는 글 앞 3개 청크에서 |
| 현재 글 기준 추천 | `GET /api/v1/posts/:id/similar` | 그 글의 청크 벡터 평균 → Vectorize topK 30 → 다른 글별 최고 점수 ≥ **0.55**, 상위 3개 |
| 관련 공식 문서 | `GET /api/v1/posts/:id/docs` | 아래 참조 |

위젯은 글 본문 페이지(`body#tt-body-page`, 경로 `/123`)에서 열리면 비슷한 글을, 아니면 최근 글을 먼저 보여준다. 비슷한 글이 없으면 최근 글로 대체.

## 답변 모드 (`answer.js`)

질문형 입력("…뭐야?", "왜…", "…차이", "어떻게…")은 `POST /api/v1/answer`로 간다. "…글 찾아줘", 카테고리, 최근 글 요청은 검색 그대로 (위젯 `isQuestion`).

1. 하이브리드 검색으로 상위 3개 글
2. 글마다 일치한 소제목 청크부터 순서대로 1,500자까지 → `[출처 n] 제목\n본문`
3. Workers AI `@cf/google/gemma-4-26b-a4b-it`(생각 끔): 출처만 근거로 2~4문장, 문장 끝에 `[n]`, 답이 없으면 정해진 문장
4. 없는 번호의 `[n]`은 지우고, 인용된 출처에 `cited: true`
5. 위젯: `[n]`은 출처 글 링크(새 탭), 아래 번호 붙은 출처 카드, 👍/👎. 답이 없으면 출처 카드만, 서비스 실패면 일반 검색

모델 선택 근거와 비교: [ADR 0008](adr/0008-answer-mode-workers-ai.md). 1회 ≈ 15 neurons, 응답 10분 캐시.

## 관련 공식 문서 매칭 (`docs.js`)

큐레이션 링크(`worker/seed/doc_links.sql`, 52개: Java/Spring/Oracle/HTML·CSS/JS/React/Web + Next.js/MCP·Claude Code/OpenCV)만 쓴다 ([ADR 0002](adr/0002-docs-as-curated-links.md)).

```
점수(문서) = Σ  가중치(키워드가 글의 어디에 있나) × IDF(키워드)
            문서 keywords
  가중치: 태그 3 / 카테고리 단계 2 / 제목 단어(조사 제거, 통째로 일치) 1
  IDF = ln(1 + 문서 수 / 그 키워드를 가진 문서 수)   ← "react"(8개 문서)보다 "foreach"(1개)가 큼
→ 점수 > 0인 상위 3개
```

예: map/forEach 글 → 리스트 렌더링, Array.forEach, Array.map (일반 React 문서보다 구체적인 문서가 위). 기술 글이 아니면(입사 일기 등) 빈 목록.

## 임계값과 측정

모두 실제 색인으로 맞췄다 ([ADR 0005](adr/0005-hybrid-search-thresholds.md)).

| 값 | 근거 (2026-10-16) | 도구 |
|---|---|---|
| 검색 의미 점수 0.5 | 관련 질문 0.55~0.77, 무관한 질문(날씨/레시피/주식) ≤ 0.48 | `GET /admin/search-debug?q=` |
| 본문 키워드도 0.5 | 0.4일 때 "오늘 날씨"가 본문에 "오늘 날짜"가 있는 Calendar 글을 가져옴 | 같음 |
| 비슷한 글 0.55 | 같은 시리즈/주제 0.62~0.83 (useEffect→useRef 0.83), 상위 3개 안의 약한 연결 0.55~0.6 | `GET /admin/similar-debug?id=` |

### 평가 (`worker/eval/`)

- `search-cases.json`: 실제 글 기준 질문 30개(기대 글 번호) + 무관한 질문 5개(결과 0개여야 함)
- `npm run eval:search -w worker`: hit@3 / top1 / 무관한 질문 오탐률. 기준 85% / 70% / 20% 미달이면 종료 코드 1
- 배포 전 비교: `wrangler dev --remote --port 8788` 후 `EVAL_API=http://localhost:8788 npm run eval:search -w worker`
  (`--remote`는 실제 D1을 쓰므로 테스트 질문이 0건 로그에 남을 수 있다 → 확인 후 지운다)

| 시점 | hit@3 | top1 | 오탐 |
|---|---|---|---|
| 첫 측정 | 97% | 90% | 0% |
| 음역 별칭 추가 후 (현재) | 100% | 93% | 0% |

## 개선 순환

1. `GET /admin/misses?days=30`으로 실제 방문자의 결과 0건 질문을 본다 ([data-model.md](data-model.md#search_misses-0003))
   `GET /admin/feedback?days=30`의 👎 많은 질문도 같이 본다 (결과는 나왔지만 원하던 글이 아님)
2. 블로그에 있는 주제인데 못 찾았다면 → 평가 세트에 추가, 별칭/불용어 조정 → 평가 재실행
3. 블로그에 없는 주제라면 → 글 주제 후보
