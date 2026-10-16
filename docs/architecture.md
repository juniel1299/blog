# Architecture

## 결정 사항

| 항목 | 결정 | 이유 |
|---|---|---|
| 호스팅 | Cloudflare Workers | 상시 서버/Docker 불필요, 무료 한도로 블로그 규모 충분 |
| 저장소 | D1 (SQLite) | 글 메타데이터, 공식 문서 링크 |
| 벡터 검색 | Vectorize | 블로그 글 청크만 임베딩 |
| 모델 | Workers AI (`bge-m3` 임베딩, 소형 LLM 요약) | 같은 계정 내 과금, 무료 일일 한도 |
| 공식 문서 | **벡터화하지 않음**. 큐레이션한 링크를 D1에 저장 | 무료 저장 한도(약 4.8k 벡터) 유지 |
| 스킨 | 신규 제작, Vite로 IIFE 단일 번들 + 고정 파일명 | 티스토리 `./images/` 경로 규칙 |
| 위젯 | React 19, `#ai-assistant`에만 마운트 | 스킨과 독립 |

## 화면

- 상단: 블로그 이름, 메뉴, 검색(티스토리 기본 검색), 다크/라이트 전환
- 본문 우측: `h1`~`h4`로 만든 목차, 현재 위치 강조. 900px 이하에서는 접히는 "목차" 버튼
- 좌측 하단: 챗봇 버튼. 480px 이하에서는 패널이 화면 대부분을 차지
- 우측 하단: 맨 위로 버튼 (400px 이상 스크롤 시)

## 챗봇 흐름 (Phase 2~3)

1. 사용자: "PostgreSQL 인덱스 글 찾아줘"
2. 검색 → 결과 카드 최대 3개
   - 한 줄 미리보기 (검색된 본문 기반으로 생성)
   - 글 제목 → 새 탭으로 열기 (`target="_blank" rel="noopener"`)
   - **관련 문서** 버튼
3. 관련 문서 클릭 → 그 글의 태그/기술 키워드로 D1의 공식 문서 링크를 조회해 대화에 이어서 표시

근거가 없으면 "관련 글을 찾지 못했어요". 링크는 저장된 URL만 사용하고 LLM이 만든 URL은 쓰지 않는다.

## 검색 (Phase 2, `worker/src/search/`)

```
질문 "인덱스에 대한 글 찾아줘"
  → 요청 표현/조사/흔한 단어("차이", "정리") 제거 → 키워드 ["인덱스"]
  → 키워드: FTS5 trigram(3자 이상) + LIKE(2자, 예: "조인")
       · 제목/소제목 일치 = 강한 신호
       · 본문만 일치 = 의미 점수 ≥ 0.5인 글일 때만 (순위 보정용)
  → 의미: bge-m3 임베딩 → Vectorize topK 20, 점수 ≥ 0.5만
  → RRF 병합 → 글당 최고 청크 1개 → 상위 3개
  → 한 줄 미리보기: 그 청크에서 질문 키워드가 있는 한국어 문장(코드 줄 제외)
```

임계값 0.5는 실제 색인으로 맞췄다 (2026-10-16, `GET /admin/search-debug`):
관련 질문은 0.55~0.77, 무관한 질문(날씨, 레시피, 주식)은 최대 0.48.
0.4로 두면 "오늘 날씨"가 본문에 "오늘"이 있는 Calendar 글을 끌고 와서 본문 키워드도 0.5를 요구한다.
Reranker와 LLM 한 줄 요약은 보류 (Phase 3 결정: 추출식 미리보기로 충분, 필요해지면 재검토).

## 데이터 모델 (`worker/migrations/0002_posts.sql`)

```
posts(id = 티스토리 글 번호, url, title, category, tags JSON, summary, published_at,
      source_lastmod, status 'indexed'|'skipped', chunk_count, indexed_at)
post_chunks(id "<postId>-<n>" = Vectorize 벡터 id, post_id, position, heading, text)
post_chunks_fts  FTS5 trigram (chunk_id, post_id, title, heading, text)   -- 한국어 부분 일치
doc_links(technology, title, url UNIQUE, description, keywords JSON)
```

Vectorize 인덱스 `tistory-posts`: 1024차원(`@cf/baai/bge-m3`), cosine, metadata `{ postId }`.

## 수집 (Phase 1)

```
Cron (*/10분) 또는 POST /admin/ingest
  → sitemap.xml 에서 글 URL + lastmod
  → D1의 source_lastmod와 비교 (새 글/수정 글/삭제된 글)
  → 삭제된 글: Vectorize 벡터 + D1 행 삭제 (사이트맵이 비면 삭제 안 함)
  → 바뀐 글 최대 3개: 글 페이지 fetch → HTMLRewriter로 제목·카테고리·태그·본문 추출
      → 소제목(h1~h4) 단위 청크 (≤1000자, 글당 ≤40개)
      → "제목\n소제목\n본문"을 bge-m3로 임베딩 → Vectorize upsert
      → D1에 글/청크/FTS 기록 (마지막에 기록하므로 중간 실패 시 다음 실행에서 재시도)
```

- 무료 플랜 제한(실행당 CPU 10ms, 서브요청 50개) 때문에 한 번에 3개씩. 최초 75개는 약 4시간에 걸쳐 채워진다. `POST /admin/ingest`를 반복 호출하면 더 빨리 채울 수 있다.
- 본문은 이 저장소 스킨의 `#article-body` 기준. 티스토리가 본문에 끼워 넣는 광고, 공감/공유 버튼, "카테고리의 다른 글"은 제외한다.
- 보호글처럼 본문이 없는 글은 `skipped`로 남겨 매번 다시 가져오지 않는다.
- 공식 문서: `worker/seed/doc_links.sql`의 큐레이션 링크(41개, 블로그 카테고리 기준). 크롤링하지 않는다.

## 남용 방지

- CORS: `ALLOWED_ORIGINS`에 블로그 도메인만 허용 (CORS는 브라우저 제한일 뿐이라 보안 수단으로 쓰지 않는다)
- IP당 요청 제한 (Workers Rate Limiting binding)
- 같은 질문은 캐시
- Workers 무료 플랜이라 한도 초과 시 과금 대신 에러 → 위젯에 "잠시 후 다시" 표시

## Phase

| Phase | 내용 |
|---|---|
| 0 | 기반: 스킨 골격, 위젯 골격, Worker 헬스체크, D1, CI ✅ |
| 1 | 스킨 디자인 완성 + 실제 티스토리 적용 ✅, 글 수집/청크/임베딩 + 공식 문서 seed ✅ (2026-10-16 배포, 75개 글 / 296 청크 색인) |
| 2 | `/api/v1/search` + 결과 카드 UI ✅ (배포 + 블로그 적용) |
| 3 | 관련 문서 버튼 ✅ (`GET /api/v1/posts/:id/docs`, 태그/카테고리/제목 × 키워드 IDF 매칭). LLM 한 줄 요약은 보류: 추출식 미리보기 유지 (비용 0, 지어낼 위험 없음). 남용 방지(IP 제한, 캐시)는 Phase 2에서 완료 |
