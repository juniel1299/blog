# Tistory AI Assistant

티스토리 신규 스킨 + 블로그 글을 찾아주는 AI 도우미(RAG).
서버는 Cloudflare Workers(서버리스)라서 개인 PC나 Docker를 켜둘 필요가 없다.

현재 상태: **Phase 0 (기반)**. 스킨 UI와 위젯 골격, 헬스체크 API만 있고 AI 답변은 아직 없다.

## 구조

```
skin/      Tistory 스킨 (Vite) + React 챗봇 위젯
  tistory/   skin.html, index.xml 원본 (빌드 시 그대로 복사)
  src/       테마 토글, 목차, 맨 위로 버튼, 위젯
  index.html 로컬 개발용 Fixture 페이지
worker/    Cloudflare Worker API + D1 마이그레이션
docs/      설계 문서
```

## 요구사항

- Node.js 22.12+ 또는 24 LTS (CI는 24)
- Cloudflare 계정 (배포할 때만)

## 로컬 개발

```bash
npm install
npm run check          # lint + test + build
```

스킨 (http://localhost:5173):

```bash
npm run dev -w skin
```

Worker (http://localhost:8787):

```bash
npm run db:migrate:local -w worker
npm run dev -w worker
curl -i http://localhost:8787/health/live
curl -i http://localhost:8787/health/ready
```

`index.html`은 실제 티스토리 렌더링을 흉내낸 Fixture일 뿐이다. 치환자 렌더링은 실제 블로그에 적용해 확인해야 한다.

## 스킨 적용

```bash
npm run zip -w skin    # skin/dist/tistory-skin.zip
```

티스토리 관리 → 꾸미기 → 스킨 변경 → 스킨 등록에서 zip 업로드.
`index.xml`의 `<default>` 값을 나중에 바꾸면 이미 적용한 스킨 설정이 초기화될 수 있다.

## Worker 배포

```bash
cd worker
npx wrangler login
npx wrangler d1 create tistory-ai-assistant   # 출력된 database_id를 wrangler.jsonc에 넣기
npm run db:migrate:remote
npm run deploy
```

배포 전 `wrangler.jsonc`의 `ALLOWED_ORIGINS`에 블로그 주소(`https://<blog>.tistory.com`)를 추가한다.
API 키 같은 비밀값은 `npx wrangler secret put <NAME>`으로 넣고 코드나 스킨에 쓰지 않는다.

## 문서

- [docs/architecture.md](docs/architecture.md): 구조, RAG 흐름, 데이터 모델, Phase 계획
- [docs/api-contract.md](docs/api-contract.md): 챗봇 API 계약 (Phase 2 구현 예정)
