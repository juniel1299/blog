# API Contract

구현된 것: `GET /health/live`, `GET /health/ready`, `POST /api/v1/search`, `GET /api/v1/posts/:postId/docs`, 관리자 API(`/admin/*`).

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

### `POST /api/v1/search`

```json
// request
{ "query": "인덱스에 대한 글 찾아줘" }

// response 200
{
  "query": "인덱스에 대한 글 찾아줘",
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

- `results`는 최대 3개(관련 높은 순), 없으면 빈 배열 → 위젯은 "관련 글을 찾지 못했어요"
- `preview`: 가장 관련 높은 청크에서 뽑은 한 줄(추출식, LLM 아님). LLM 한 줄 요약은 Phase 3
- `query` 1~200자 문자열, 요청 본문 2KB 이하. 그 외 400 `INVALID_QUERY`
- IP당 분당 20회. 초과 시 429 `RATE_LIMITED`
- POST 외 메서드 405 `METHOD_NOT_ALLOWED`, 내부 오류 500 `SEARCH_FAILED`
- 같은 질문(대소문자/공백 정규화)은 10분 캐시

관리자용 `GET /admin/search-debug?q=` 는 후보(키워드/벡터 점수)와 최종 선택을 보여준다 (임계값 조정용).
결과가 0건인 질문은 `search_misses`에 **정규화한 질문 텍스트만** 기록한다 (IP·식별자 없음, 90일 후 cron이 삭제).
관리자용 `GET /admin/misses?days=30` (1~90) → `{ days, misses: [{ query, count, last_seen }] }` 상위 50개.

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
