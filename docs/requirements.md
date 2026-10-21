# 요구사항과 현재 상태

기준일 2026-10-16. 블로그: https://problem-child.tistory.com (주니엘의 개발일지, 글 75개)

## 목표

티스토리 블로그에 새 스킨을 입히고, 방문자가 "A에 대한 글 찾아줘"라고 물으면 블로그 글을 찾아 주는 챗봇을 붙인다.
개인 PC나 Docker를 켜 두지 않고, 무료 한도 안에서 운영한다.

## 요구사항

| # | 요구사항 | 상태 | 구현 / 비고 |
|---|---|---|---|
| R1 | 티스토리 스킨 직접 제작 | ✅ | `skin/` → 실제 블로그 적용 ([skin.md](skin.md)) |
| R2 | 다크/라이트 전환 버튼 | ✅ | 선택값 `localStorage` 저장, 처음엔 OS 설정 따름 |
| R3 | 맨 위로 버튼 | ✅ | 우측 하단, 400px 이상 스크롤 시 표시 |
| R4 | 검색 영역 | ✅ | 헤더 검색창 (티스토리 기본 검색) |
| R5 | 본문 `#`, `##` 제목의 우측 목차 | ✅ | `h1`~`h4`, 현재 위치 강조, 1080px 이하에서는 접히는 "목차" 버튼 |
| R6 | 챗봇 좌측 하단(7시) 고정 | ✅ | `#ai-assistant`에 React 위젯 마운트 |
| R7 | "A에 대한 글 찾아줘" → 한 줄 미리보기 + 글 제목(새 탭) | ✅ | 하이브리드 검색 ([rag-design.md](rag-design.md)). 미리보기는 본문 추출 문장 ([ADR 0004](adr/0004-extractive-preview.md)) |
| R8 | 글별 "관련 문서" 버튼 → 공식 문서 링크 | ✅ | 큐레이션 41개, 키워드 매칭 ([ADR 0002](adr/0002-docs-as-curated-links.md)) |
| R9 | Docker/상시 PC 없이 운영 | ✅ | Cloudflare Workers + D1 + Vectorize + Workers AI ([ADR 0001](adr/0001-cloudflare-serverless.md)) |
| R10 | 비용 최소화 | ✅ | 무료 플랜 한도 안에서 동작 ([operations.md](operations.md#비용과-무료-한도)) |
| R11 | RAG를 정교하게 | ✅ | 키워드+의미 검색, RRF, 실데이터로 맞춘 임계값, 평가 세트 hit@3 100% / top1 93% / 오탐 0% |

### 진행 중 추가된 요구사항

| # | 요구사항 | 상태 | 구현 |
|---|---|---|---|
| A1 | 스킨 디자인 보강 | ✅ | 히어로, 카드 목록, 읽기 진행바, 이전/다음 글, 카테고리 다른 글, 사이드바 위젯 |
| A2 | 기존 스킨의 애드센스/네이버 인증 유지 | ✅ (일부) | 애드센스 로더, 네이버 사이트 인증 유지. 기존 스킨의 수동 광고 슬롯은 새 레이아웃에 없음 |
| A3 | GitHub 업로드 | ✅ | https://github.com/juniel1299/blog (public) |
| A4 | Worker 자동 배포 | ✅ | `main` 머지 → GitHub Actions 배포 ([operations.md](operations.md)) |
| A5 | 검색 품질 측정 + 0건 질문 로그 | ✅ | `npm run eval:search`, `GET /admin/misses` |
| A6 | 더 보기 / 카테고리 범위 검색 / 최근 글·예시 질문 / 현재 글 기준 추천 | ✅ | [rag-design.md](rag-design.md#대화-기능) |
| A7 | 2차: 코드 복사, 읽기 시간, 시리즈, 헤더 하이브리드 검색, 공식 문서 확장, 👍/👎, Q&A 답변 모드 | ✅ | [rag-design.md](rag-design.md#답변-모드-answerjs), [ADR 0008](adr/0008-answer-mode-workers-ai.md) |

## 범위 밖 / 남은 것

- 스킨 배포 자동화: 티스토리 업로드 API가 없어 스킨 편집 화면에서 수동 반영 ([skin.md](skin.md#배포-수동))
- LLM 한 줄 요약, Reranker: 보류 ([ADR 0004](adr/0004-extractive-preview.md))
- 공식 문서는 블로그 카테고리(Java, Spring, Oracle SQL, HTML/CSS, JavaScript, React, Web) 위주. 그 밖의 주제는 링크 없음
- 채팅 히스토리 저장, 관리자 대시보드 UI: 없음 (관리자 API로 대체)
