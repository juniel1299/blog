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

## 검색 파이프라인

```
질문 → 키워드 추출
     → [D1 FTS5 키워드 검색] + [Vectorize 의미 검색]
     → RRF 병합 → 글 단위 중복 제거 → 상위 3개
     → 한 줄 미리보기 생성 (LLM, 검색된 청크만 컨텍스트)
```

Reranker는 결과 품질을 본 뒤 결정한다.

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
- 공식 문서: `worker/seed/doc_links.sql`의 큐레이션 링크(38개, 블로그 카테고리 기준). 크롤링하지 않는다.

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
| 2 | `/api/v1/search` + 결과 카드 UI |
| 3 | 관련 문서 버튼, 한 줄 미리보기 생성, 남용 방지 |
