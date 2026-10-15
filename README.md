# Tistory AI Assistant

티스토리 신규 스킨 + 블로그 글을 찾아주는 AI 도우미(RAG).
서버는 Cloudflare Workers(서버리스)라서 개인 PC나 Docker를 켜둘 필요가 없다.

현재 상태: **Phase 2**. 스킨은 실제 블로그에 적용됨. Worker(`https://tistory-ai-assistant-api.youngs5440.workers.dev`)가 10분마다 바뀐 글을 수집해 색인하고, 챗봇이 `POST /api/v1/search`로 관련 글 카드(한 줄 미리보기 + 새 탭 링크)를 보여준다. 관련 공식 문서 버튼은 Phase 3.

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

Worker (http://localhost:8787). AI/Vectorize는 Cloudflare 로그인 없이 로컬에서 쓸 수 없으므로 `dev:local`은 둘을 뺀 설정으로 띄운다:

```bash
npm run db:migrate:local -w worker
npm run db:seed:local -w worker
echo "ADMIN_TOKEN=$(openssl rand -hex 24)" > worker/.dev.vars
npm run dev:local -w worker
curl -i http://localhost:8787/health/ready
```

글 하나가 어떻게 추출/청크되는지 확인 (쓰기 없음):

```bash
curl -H "authorization: Bearer <ADMIN_TOKEN>" "http://localhost:8787/admin/preview?id=123"
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
npx wrangler vectorize create tistory-posts --dimensions=1024 --metric=cosine
npm run db:migrate:remote
npm run db:seed:remote
openssl rand -hex 24 | npx wrangler secret put ADMIN_TOKEN   # 값은 따로 보관
npm run deploy
```

배포하면 Cron이 10분마다 바뀐 글을 3개씩 색인한다. 바로 채우려면:

```bash
curl -X POST -H "authorization: Bearer <ADMIN_TOKEN>" https://<worker>.workers.dev/admin/ingest
```

배포 전 `wrangler.jsonc`의 `ALLOWED_ORIGINS`에 블로그 주소(`https://<blog>.tistory.com`)를 추가한다.
비밀값은 `npx wrangler secret put <NAME>`으로 넣고 코드나 스킨에 쓰지 않는다.

## 문서

- [docs/architecture.md](docs/architecture.md): 구조, RAG 흐름, 데이터 모델, Phase 계획
- [docs/api-contract.md](docs/api-contract.md): 챗봇 API 계약 (Phase 2 구현 예정)
