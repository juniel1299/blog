# ADR 0003: 수집은 Worker Cron에서 증분으로

- 상태: 채택 (2026-10-16)

## 배경

글을 가져오는 방법 후보: (a) GitHub Actions에서 Node 스크립트로 수집 후 Worker에 전송, (b) Worker Cron이 직접 수집.
무료 플랜은 실행당 CPU 10ms, 서브요청 50개 제한이 있다.

## 결정

- Worker Cron(`*/10 * * * *`)이 sitemap `lastmod`와 D1을 비교해 **바뀐 글만, 한 번에 최대 3개** 처리한다
- HTML 파싱은 네이티브 `HTMLRewriter`(스트리밍)로 CPU를 아낀다
- 같은 동작을 `POST /admin/ingest`로 수동 실행할 수 있다

## 이유

- 외부 저장소/시크릿 없이 Cloudflare 안에서 끝남
- 평소에는 바뀐 글이 거의 없어 실행이 가볍다

## 결과

- 최초 75개 색인은 cron만으로 약 4시간 → 관리자 API를 반복 호출해 몇 분 만에 채웠다
- 본문 추출은 이 저장소 스킨의 `#article-body` 구조에 의존한다. 스킨 구조를 바꾸면 추출기도 확인해야 한다
- HTMLRewriter는 Node 테스트에서 못 돌아서, 순수 로직(sitemap/청크/텍스트)만 단위 테스트하고 추출은 `/admin/preview`로 실제 글에서 확인했다
