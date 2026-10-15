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

## 데이터 모델 (Phase 1에서 생성 예정)

```
posts(id, url UNIQUE, title, summary, tags, category, published_at, updated_at, content_hash)
post_chunks(id, post_id → posts, heading, text, position)   -- 벡터 id = chunk id
post_chunks_fts (FTS5: title, heading, text)
doc_links(id, technology, title, url UNIQUE, description, version)
post_doc_links(post_id, doc_link_id)   -- 선택: 수동 지정
```

Phase 0 마이그레이션은 `app_meta`만 만든다.

## 수집

- 티스토리 글: 공개 RSS/사이트맵으로 주기 수집 (Cron Trigger). `content_hash`가 바뀐 글만 재임베딩, 사라진 글은 삭제.
- 공식 문서: 기술별 링크 목록을 seed 파일로 관리 (React, Next.js, Spring Boot, Django, PostgreSQL, FastAPI 등). 크롤링하지 않는다.

## 남용 방지

- CORS: `ALLOWED_ORIGINS`에 블로그 도메인만 허용 (CORS는 브라우저 제한일 뿐이라 보안 수단으로 쓰지 않는다)
- IP당 요청 제한 (Workers Rate Limiting binding)
- 같은 질문은 캐시
- Workers 무료 플랜이라 한도 초과 시 과금 대신 에러 → 위젯에 "잠시 후 다시" 표시

## Phase

| Phase | 내용 |
|---|---|
| 0 | 기반: 스킨 골격, 위젯 골격, Worker 헬스체크, D1, CI ✅ |
| 1 | 스킨 디자인 완성 + 실제 티스토리 적용 검증, 글 수집/청크/임베딩 |
| 2 | `/api/v1/search` + 결과 카드 UI |
| 3 | 관련 문서 버튼, 한 줄 미리보기 생성, 남용 방지 |
