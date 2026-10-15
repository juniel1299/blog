# API Contract

구현된 것: `GET /health/live`, `GET /health/ready`, `POST /api/v1/search`, 관리자 API(`/admin/*`). `GET /api/v1/posts/:postId/docs`는 **계획**(Phase 3).

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

## 계획 (Phase 3)

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
