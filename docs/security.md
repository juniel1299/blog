# 보안과 개인정보

## 위협과 대응

| 위협 | 대응 | 위치 |
|---|---|---|
| 공개 API 남용 / 무료 한도 소진 | IP당 분당 20회(Rate Limiting binding), 응답 10분 캐시, 질문 200자·본문 2KB 제한 | `api.js`, `wrangler.jsonc` |
| 관리자 API 노출 | `Bearer ADMIN_TOKEN`, 길이 같을 때만 비교하는 상수 시간 비교, 토큰 없거나 32자 미만이면 기능 자체 꺼짐, 실패 시 401이 아닌 404로 존재를 숨김 | `admin.js` |
| 내부 정보 노출 | 오류 응답은 코드+일반 메시지만. 스택/SQL/원인은 Worker 로그에만 | `http.js`, 각 핸들러 |
| SQL 인젝션 | 모든 값 바인딩(`?`). FTS 검색어는 따옴표로 감싸 연산자 무력화, LIKE는 `%`/`_` 이스케이프 | `search.js`, `query.js` |
| XSS | 위젯은 React 렌더링만(HTML 주입 없음). 목차는 `textContent`. 링크는 `http(s)`만 | `widget/`, `toc.js` |
| 지어낸 링크 | 링크는 색인된 글 URL과 큐레이션 `doc_links`에서만 나옴. LLM이 링크를 만들지 않음 | [ADR 0002](adr/0002-docs-as-curated-links.md), [0004](adr/0004-extractive-preview.md) |
| CORS | `ALLOWED_ORIGINS`(블로그 도메인, 로컬 개발)만 헤더 부여. CORS는 브라우저 제한일 뿐 인증 수단이 아님 | `http.js` |
| 수집기 오용 | 글 fetch는 `BLOG_ORIGIN`의 `/숫자` 글만. 관리자 preview도 숫자 id만 받아 블로그 주소로 조합 | `sitemap.js`, `admin.js` |
| 사이트맵 장애로 전체 삭제 | 사이트맵이 비면 삭제하지 않음, 1회 삭제도 3개까지 | `sitemap.js` planSync |

## 비밀값

- 저장소는 **public**이다. 비밀값을 파일(특히 `ci.yml`)에 쓰지 않는다
- `ADMIN_TOKEN`: Worker secret + 로컬 `worker/.dev.vars`(`.gitignore`)
- Cloudflare 토큰: GitHub 시크릿 `BLOG`. 최소 권한 ([operations.md](operations.md#cicd-githubworkflowsciyml)), Zone 권한 없음
- 배포 잡은 토큰 형식(`Bearer `, 공백, 따옴표 포함 여부)만 확인하고 값을 출력하지 않는다. Actions는 시크릿을 로그에서 가린다

### 지금까지의 사고와 조치

- 2026-10-16: 워크플로 파일에 토큰으로 넣은 값이 public 저장소 커밋 이력(`4e420b8`)에 남음 → 해당 값 폐기 확인. 이후 시크릿으로만 주입
- 대화 중 토큰이 노출된 경우마다 Roll 후 새 토큰만 시크릿에 등록

폐기된 값은 이력에 남아도 쓸 수 없으므로 이력 재작성은 하지 않았다.

## 개인정보

- **결과 0건 질문 로그**(`search_misses`): 정규화한 질문 텍스트와 시각만. IP, User-Agent, 쿠키, 식별자 없음. 90일 후 자동 삭제
- **검색 결과 피드백**(`search_feedback`): 정규화한 질문, 👍/👎, 보여준 글 번호, 시각만. 식별자 없음. 90일 후 자동 삭제
- 그 외 질문은 저장하지 않는다 (Workers 로그에 오류 이벤트만, 질문 원문은 남기지 않음)
- Rate Limiting은 IP를 키로 쓰지만 Cloudflare 내부 카운터일 뿐 저장하지 않는다
- 위젯은 `localStorage`에 테마(`light`/`dark`)만 저장
- 방문자에게 알릴 필요가 있다면 블로그 안내 문구: "챗봇에서 결과가 없었던 질문은 검색 개선을 위해 질문 내용만(개인 식별 정보 없이) 90일간 보관합니다."
