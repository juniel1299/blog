# Tistory AI Assistant

티스토리 신규 스킨 + 블로그 글을 찾아주는 AI 도우미(RAG).
서버는 Cloudflare Workers(서버리스)라서 개인 PC나 Docker를 켜둘 필요가 없다.

현재 상태: 운영 중. 스킨이 실제 블로그에 적용돼 있고, Worker(`https://tistory-ai-assistant-api.youngs5440.workers.dev`)가 10분마다 바뀐 글을 색인한다. 챗봇은 글 검색(한 줄 미리보기 + 새 탭 링크), [관련 문서], [더 보기], 카테고리 범위 검색, 최근 글, 지금 읽는 글과 비슷한 글을 제공한다. 자세한 상태는 [docs/requirements.md](docs/requirements.md).

## 구조

```
skin/      Tistory 스킨 (Vite) + 챗봇 위젯 (React 문법, Preact로 번들)
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

## 자동 배포

`main`에 머지되면 GitHub Actions(`.github/workflows/ci.yml`의 `deploy` 잡)가 검사 통과 후
D1 마이그레이션 → 공식 문서 seed → `wrangler deploy` → `/health/ready` 확인 순으로 Worker를 배포한다.
스킨은 티스토리 업로드 API가 없어서 계속 수동(`npm run zip -w skin` 후 스킨 편집에서 업로드).

처음 한 번 설정:

1. Cloudflare 대시보드 → My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** 템플릿
   - 권한 추가: Account / **D1** / Edit, Account / **Vectorize** / Edit
   - Account Resources: 이 계정만
2. GitHub 저장소 → Settings → Secrets and variables → Actions → **Repository secrets** → New repository secret
   - `BLOG`: 위에서 만든 토큰. `cfut_...`로 시작하는 값만 (`Bearer `, 따옴표, 줄바꿈 없이)
   - `FLARE`: Account ID (Workers & Pages 화면 오른쪽 Account details, 32자리)

워크플로는 이 두 시크릿을 wrangler가 읽는 환경변수 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`로 넘긴다.
저장소가 public이므로 토큰을 `ci.yml` 같은 파일에 직접 쓰지 않는다. 노출됐다면 Cloudflare에서 즉시 Roll 한다.

`ADMIN_TOKEN` 같은 Worker secret은 배포로 바뀌지 않는다 (`wrangler secret put`으로만 변경).

## 검색 품질

```bash
npm run eval:search -w worker        # 배포된 Worker 대상, worker/.dev.vars의 ADMIN_TOKEN 사용
```

검색 로직을 바꾸면 이 평가를 돌려 hit@3 / top1 / 오탐률이 나빠지지 않았는지 확인한다 (기록은 docs/architecture.md).
결과 0건 질문 상위 목록: `curl -H "authorization: Bearer <ADMIN_TOKEN>" "<Worker URL>/admin/misses?days=30"`

## 문서

[docs/README.md](docs/README.md)에서 시작한다: 요구사항·현재 상태, 아키텍처, RAG 설계, 데이터 모델, API, 스킨, 운영, 보안, 개발 이력, 결정 기록(ADR).
