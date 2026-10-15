# API Contract

구현된 것: `GET /health/live`, `GET /health/ready`. 나머지는 **계획**이며 아직 없다.

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

## 계획 (Phase 2~3)

### `POST /api/v1/search`

```json
// request
{ "query": "PostgreSQL 인덱스 글 찾아줘" }

// response
{
  "results": [
    {
      "postId": "123",
      "title": "PostgreSQL 인덱스와 EXPLAIN 이해하기",
      "url": "https://<blog>.tistory.com/123",
      "preview": "B-tree 인덱스와 실행 계획으로 조회 성능을 확인하는 글입니다."
    }
  ],
  "requestId": "..."
}
```

- `results`는 최대 3개, 없으면 빈 배열
- `query` 1~200자, 그 외 400 `INVALID_QUERY`
- 제한 초과 429 `RATE_LIMITED`

### `GET /api/v1/posts/:postId/docs`

```json
{
  "docs": [
    { "technology": "PostgreSQL", "title": "Indexes", "url": "https://www.postgresql.org/docs/current/indexes.html", "description": "인덱스 종류와 사용 조건" }
  ],
  "requestId": "..."
}
```

- 링크는 D1 `doc_links`에 저장된 것만 반환
- 없는 글 404 `POST_NOT_FOUND`

스트리밍(SSE)은 응답이 짧은 카드 형식이라 필요해지면 그때 추가한다.
