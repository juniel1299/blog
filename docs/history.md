# 개발 이력

모두 2026-10-16. 커밋은 `main` 기준, PR은 https://github.com/juniel1299/blog/pulls

| 단계 | 커밋 / PR | 내용 | 검증 |
|---|---|---|---|
| 설계 | – | ChatGPT 초안(FastAPI + Postgres + Docker) → Docker 없이 운영해야 해서 Cloudflare로 전환, 공식 문서는 링크만 | 무료 한도 비교 ([ADR 0001](adr/0001-cloudflare-serverless.md), [0002](adr/0002-docs-as-curated-links.md)) |
| Phase 0 기반 | `befcca5` | 모노레포(skin, worker), 스킨 골격(테마/목차/맨 위로), 위젯 골격, Worker 헬스체크, D1 0001, CI | 테스트 25개, 로컬 D1 마이그레이션, 실제 `wrangler dev` 응답 |
| 스킨 디자인·적용 | `7462316` | 히어로/카드/읽기 진행바/이전·다음/사이드바, 기존 스킨 보관 후 실제 블로그 적용, 애드센스·네이버 인증 유지, 댓글(레거시 블록 필요) 해결 | 실제 블로그 홈/글/댓글/다크 모드 확인 |
| Phase 1 수집 | `c8410c0` | sitemap 증분 비교, HTMLRewriter 추출, 청크, bge-m3 임베딩, Vectorize/D1/FTS 저장, Cron, 관리자 API, doc_links seed | Cloudflare 배포, 75개 글 / 296 청크 색인, D1·FTS·Vectorize 수 일치 |
| Phase 2 검색 | `245ae8a` (PR #1) | `POST /api/v1/search` 하이브리드 검색, 임계값 보정, 위젯 결과 카드 | 실제 질문으로 임계값 조정, 블로그 반영 |
| Phase 3 관련 문서 | `1366edf` (PR #2) | `GET /api/v1/posts/:id/docs`, IDF 매칭, seed 41개, [관련 문서] 버튼. LLM 요약은 보류 | 실제 글 8개 매칭 확인, 블로그 반영 |
| 자동 배포 | `d86db31` (PR #3) ~ `291cfbc` (PR #4) | main 머지 시 마이그레이션 → seed → 배포 → 헬스체크. 시크릿 `BLOG`/`FLARE`, actions v5 | CI #11, #13 배포 성공 |
| 검색 품질 | `e4af37e` (PR #5) | 평가 세트 35개 + 실행기, 음역 별칭, 결과 0건 로그(0003) + `/admin/misses` | hit@3 97→100%, top1 90→93%, 오탐 0%. 0건 로그 실서비스 확인 |
| 대화 기능 | `9759812` (PR #6) | 더 보기, 카테고리 범위 검색, 최근 글/예시 질문, 현재 글 기준 비슷한 글, `/admin/similar-debug` | 평가 회귀 없음, 실제 블로그 글/홈 페이지에서 확인 |

## 겪은 문제와 해결

| 문제 | 원인 | 해결 |
|---|---|---|
| 첫 `npm install` 실패 (`edgesOut`) | npm 11.1 의존성 해석 버그 | 최신 npm으로 설치 |
| jsdom 테스트가 안 돎 | 로컬 Node 23.7에서 jsdom 30 미지원 | jsdom 26 사용, CI는 Node 24 |
| 모바일에서 가로 넘침 | 그리드 `1fr`이 긴 `<pre>`에 늘어남 | `minmax(0, 1fr)` |
| 실제 블로그 댓글이 안 나옴 | `[##_comment_group_##]`만으로는 빈 값 | 레거시 `<s_rp_container>` 등을 함께 두고 새 댓글 앱이 뜨면 CSS로 숨김 |
| 본문 색인에 "카테고리의 다른 글"이 섞임 | 티스토리가 본문에 끼워 넣음 | 수집기에서 해당 요소 제외 |
| "오늘 날씨" 질문에 Calendar 글 | 본문 단어 "오늘" 매칭 | 본문만의 키워드도 의미 점수 0.5 요구 |
| "머티리얼라이즈드 뷰" 못 찾음 | 글은 영어 표기 | 음역 별칭 |
| 스킨 적용이 안 됨 | 적용 버튼 옆을 클릭 | 버튼 위치 확인 후 가운데 클릭 |
| 자동 배포 실패 (계정 ID, 토큰 형식, 하드코딩) | 시크릿 값/이름 혼동, 워크플로에 값 직접 기입 | 시크릿으로만 주입, 형식 검사 추가, 노출 값 폐기 ([security.md](security.md)) |
| 작업 중 체크아웃이 `main`으로 바뀜 | 외부(앱/GitHub Desktop)에서 브랜치 전환 | 브랜치에 커밋해 두어 손실 없음, 다시 체크아웃 |
