# API Contract

구현된 것: `GET /health/live`, `GET /health/ready`, `POST /api/v1/search`, `GET /api/v1/posts/recent`, `GET /api/v1/posts/:postId/similar`, `GET /api/v1/posts/:postId/docs`, `GET /api/v1/posts/:postId/series`, `POST /api/v1/feedback`, `POST /api/v1/answer`, `POST /api/v1/events`, 관리자 API(`/admin/*`). 공개 API는 모두 같은 IP 제한(분당 20회)을 쓴다.

## 공통

- 모든 응답에 `x-request-id` 헤더 (Cloudflare `cf-ray` 또는 UUID)
- 오류 형식:

```json
{ "error": { "code": "NOT_READY", "message": "Service is not ready" }, "requestId": "..." }
```

- 오류 메시지에 스택, SQL, 내부 정보는 넣지 않는다 (서버 로그에만)

## 구현됨

| Method | Path | 200 | 실패 |
|---|---|---|---|
| GET | `/health/live` | `{ "status": "live" }` | - |
| GET | `/health/ready` | `{ "status": "ready" }` (D1 `SELECT 1` 성공) | 503 `NOT_READY` |

### 관리자 API

`Authorization: Bearer <ADMIN_TOKEN>` 필수. 토큰이 없거나 틀리면, 또는 서버에 32자 이상의 `ADMIN_TOKEN`이 설정돼 있지 않으면 존재 자체를 숨기도록 404.

| Method | Path | 200 | 실패 |
|---|---|---|---|
| POST | `/admin/ingest` | 수집 1회 실행 결과 `{ indexed, skipped, failed, deleted, remaining }` (글 번호 배열, remaining은 남은 개수) | 500 `ADMIN_FAILED` (사이트맵 실패 등) |
| GET | `/admin/preview?id=<글번호>` | 쓰기 없이 추출/청크 결과 `{ post, chunks }` | 400 `INVALID_ID`, 500 `ADMIN_FAILED` |
| GET | `/admin/search-debug?q=<질문>` | `{ parsed, strong, body, vector: [{id, score}], picked }` 검색 후보와 점수, 최종 선택 (캐시·IP 제한 없음, `eval:search`가 사용) | 400 `INVALID_QUERY` |
| GET | `/admin/similar-debug?id=<글번호>` | `{ id, scores: [{postId, score}] }` 비슷한 글 점수 상위 10개 (임계값 없이) | 400 `INVALID_ID` |
| GET | `/admin/misses?days=<1~90>` | `{ days, misses: [{query, count, last_seen}] }` 결과 0건 질문 상위 50개 (기본 30일) | 400 `INVALID_DAYS` |
| GET | `/admin/insights?days=<1~90>` | 인사이트 대시보드 데이터 (`google`: Search Console 합계·검색어·노출 많고 클릭 적은 검색어 포함): `summary`(조회·평균 시간·읽은 깊이·끝까지 읽음 비율·질문·AI 답변·클릭·0건·👍/👎), `daily`(한국 날짜별 조회), `posts`(글별 조회·이전 기간 대비 변화·평균 시간·읽힘률·챗봇 클릭), `rising`, `sources`, `referrers`, `keywords`, `questions`(횟수·AI 답변·클릭률), `clickSources`, `misses`, `disliked`. `cache-control: no-store` | 400 `INVALID_DAYS` |
| GET | `/admin/insights/topics?days=<1~90>` | `{ days, topics: [{label, count, examples, kinds}], gaps: [{label, count, examples, kinds, type: new\|improve, nearest: {postId, title, url, score}}] }` 질문 주제와 다음 글 후보 | 400 `INVALID_DAYS` |
| POST | `/admin/gsc/sync` | Search Console 최근 7일을 지금 가져옴 `{ rows, start, end }` 또는 `{ skipped: true }`(비밀값 없음). 실패 시 500, 원인(구글 메시지)은 Worker 로그에 | 500 `ADMIN_FAILED` |
| GET | `/admin/weekly` | `{ weeks: [{week, summary, report, createdAt}] }` 최근 12주 주간 인사이트 | |
| POST | `/admin/weekly` | 이번 주(한국 시간 월요일 기준) 주간 인사이트를 지금 만들어 저장 (덮어씀)하고 노션으로 보냄 `{ week, summary, report, notion: {pageId, url} \| {skipped: true} \| {error} }` | 500 `ADMIN_FAILED` |
| GET | `/admin/feedback?days=<1~90>` | `{ days, totals: {up, down}, queries: [{query, down, up, lastPostIds, last_seen}] }` 👎 많은 질문 상위 50개 | 400 `INVALID_DAYS` |

### `POST /api/v1/search`

```json
// request
{ "query": "인덱스에 대한 글 찾아줘", "offset": 0 }

// response 200
{
  "query": "인덱스에 대한 글 찾아줘",
  "mode": "search",
  "category": null,
  "offset": 0,
  "hasMore": true,
  "results": [
    {
      "postId": 122,
      "title": "[Oracle SQL] Index 란? (ft. 뭐든 과하면 독이다)",
      "url": "https://problem-child.tistory.com/122",
      "category": "SQL(oracle)",
      "heading": "인덱스란 ?",
      "preview": "단, 인덱스 또한 생성의 개념이므로 디스크 공간을 차지함 ..."
    }
  ],
  "requestId": "..."
}
```

- 한 번에 최대 6개를 계산해 캐시하고 3개씩 준다. `offset`은 0 또는 3("더 보기"), 그 외 400. `hasMore`가 true면 다음 페이지가 있다
- `mode`:
  - `search`: 일반 검색
  - `category`: "X 카테고리(에서) …" → X가 글 카테고리 경로의 한 단계와 일치하는 글만 (자바→java, 리액트→react 별칭; "java"는 "JavaScript"와 매칭되지 않음). 카테고리 말고 다른 단어가 없으면 그 카테고리 최신 글
  - `recent`: "최근 글 보여줘"처럼 최근 글만 묻는 경우 최신 글 목록
- `results`가 없으면 빈 배열 → 위젯은 "관련 글을 찾지 못했어요" (category면 "'X' 카테고리에서 …")
- `preview`: 가장 관련 높은 청크에서 뽑은 한 줄(추출식, LLM 아님). LLM 한 줄 요약은 Phase 3
- `query` 1~200자 문자열, 요청 본문 2KB 이하. 그 외 400 `INVALID_QUERY`
- IP당 분당 20회. 초과 시 429 `RATE_LIMITED`
- POST 외 메서드 405 `METHOD_NOT_ALLOWED`, 내부 오류 500 `SEARCH_FAILED`
- 같은 질문(대소문자/공백 정규화)은 10분 캐시

관리자용 `GET /admin/search-debug?q=` 는 후보(키워드/벡터 점수)와 최종 선택을 보여준다 (임계값 조정용).
결과가 0건인 질문은 `search_misses`에 **정규화한 질문 텍스트만** 기록한다 (IP·식별자 없음, 90일 후 cron이 삭제).
관리자용 `GET /admin/misses?days=30` (1~90) → `{ days, misses: [{ query, count, last_seen }] }` 상위 50개.

### `GET /api/v1/posts/recent`

`{ "posts": [카드 x3], "requestId" }`: 최신 글 3개 (카드 형식은 search의 results와 같음, preview는 글 앞부분 문장). 위젯이 글 목록 페이지에서 열릴 때 보여준다.

### `GET /api/v1/posts/:postId/similar`

`{ "postId", "posts": [카드 최대 3개], "requestId" }`: 그 글과 비슷한 글. 글의 청크 벡터 평균으로 Vectorize를 검색해 다른 글마다 최고 점수, 0.55 이상만.
색인되지 않은 글 404 `POST_NOT_FOUND`. 위젯이 글 본문 페이지(`/123`)에서 열릴 때 보여준다 (없으면 최근 글).
관리자용 `GET /admin/similar-debug?id=` 는 점수 상위 10개를 보여준다 (임계값 조정용).

### `GET /api/v1/posts/:postId/series`

`{ "postId", "series": { "name", "posts": [{ postId, title, url }] } | null, "requestId" }`: 제목이 `[이름] 7. …` 또는 `[이름] … - 2` 형식인 글의 시리즈(같은 이름, 회차 순, 2편 이상). 시리즈가 아니면 `series: null`, 색인되지 않은 글 404 `POST_NOT_FOUND`. 스킨이 글 머리 아래 시리즈 상자에 쓴다.

### `POST /api/v1/answer`

```json
// POST /api/v1/answer {"query": "Redux랑 Zustand 차이가 뭐야?"} -> 200
{
  "query": "Redux랑 Zustand 차이가 뭐야?",
  "answer": "Redux는 구조적이고 … [1]. 반면 Zustand는 … [1].",
  "sources": [{ "postId": 119, "title": "…", "url": "https://…/119", "category": "JavaScript/React", "heading": "…", "preview": "…", "cited": true }],
  "requestId": "..."
}
```

- `answer`의 `[n]`은 `sources[n-1]`. 출처는 검색 상위 3개 글 (카드 형식 + `cited`)
- 맞는 글이 없으면 `answer: null, sources: []`, 글은 있지만 답이 안 되면 `answer: null` + sources
- 본문 검증은 search와 같음(400 `INVALID_QUERY`). 모델 실패·무료 한도 소진 503 `ANSWER_UNAVAILABLE` → 위젯은 검색으로 대체
- 같은 IP 제한, 정규화한 질문 기준 10분 캐시

### `POST /api/v1/events`

스킨/위젯이 `navigator.sendBeacon`으로 보내는 수집 이벤트 (본문은 text/plain JSON이라 CORS preflight 없음). 유효하면 항상 204 (저장 실패는 로그만, 페이지에 영향 없음).

```json
{ "type": "view", "path": "/98", "postId": 98, "referrer": "https://search.naver.com/...?query=…", "depth": 75, "seconds": 42 }
{ "type": "click", "postId": 119, "position": 1, "source": "answer", "query": "Redux랑 Zustand 차이?" }
```

- 검증: 2KB, `path`는 `/`로 시작 200자, `depth` 0/25/50/75/100, `seconds` 0~86400, `position` 1~6, `source` chat/answer/list/header. 아니면 400 `INVALID_EVENT`
- 리퍼러는 서버에서 호스트와 검색엔진 검색어만 뽑아 저장 (`events.js` parseReferrer)
- IP당 분당 60회 (`EVENTS_LIMITER`, 검색 한도와 별도)

`POST /api/v1/search`는 선택 필드 `source: "header"`를 받는다 (헤더 검색은 질문 기록에서 제외).

### `POST /api/v1/feedback`

`{ "query": "리액트 상태관리", "vote": "up" | "down", "postIds": [98, 99] }` → 200 `{ ok: true }`. 위젯이 검색 결과 한 페이지 아래 👍/👎로 보낸다.
질문은 정규화해 `search_feedback`에 저장 (IP·식별자 없음). 잘못된 본문(1KB 초과, vote 외 값, postIds 0개 또는 4개 이상) 400 `INVALID_FEEDBACK`, 저장 실패 500 `FEEDBACK_FAILED`. 같은 IP 제한.

### `GET /api/v1/posts/:postId/docs`

```json
// GET /api/v1/posts/123/docs -> 200
{
  "postId": 123,
  "docs": [
    { "technology": "react", "title": "리스트 렌더링", "url": "https://ko.react.dev/learn/rendering-lists", "description": "map으로 목록 렌더링과 key" }
  ],
  "requestId": "..."
}
```

- 링크는 D1 `doc_links`(큐레이션 seed)에 저장된 것만 반환. LLM이 만든 링크는 없다
- 글의 태그(가중치 3) / 카테고리(2) / 제목 단어(1)와 문서 keywords를 비교하고, 여러 문서에 흔한 키워드는 덜 치도록 IDF로 가중해 상위 3개
- 맞는 문서가 없으면 `docs: []` → 위젯은 "이 글과 연결된 공식 문서가 아직 없어요"
- 색인되지 않은 글 404 `POST_NOT_FOUND`, GET 외 405, 내부 오류 500 `DOCS_FAILED`
- 검색과 같은 IP 제한(분당 20회), `cache-control: public, max-age=600`

스트리밍(SSE)은 응답이 짧은 카드 형식이라 필요해지면 그때 추가한다.
