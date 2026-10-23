# 티스토리 스킨

## 구조

```
skin/
  tistory/skin.html   치환자 템플릿 원본 (빌드 시 그대로 복사 = 치환자 보존)
  tistory/index.xml   스킨 정보 (스킨 등록용. 현재 블로그는 편집 방식이라 반영 안 됨)
  src/main.js         진입점: 테마, 맨 위로, 목차, 읽기 진행바, 위젯 마운트
  src/scripts/        theme.js, toc.js, top-button.js, read-progress.js
  src/styles/main.css 디자인 토큰(라이트/다크) + 레이아웃 + 위젯
  src/widget/         ChatWidget.jsx, ResultCard.jsx, api.js, mount.jsx
  index.html, post.html  로컬 Fixture (목록 / 본문 페이지 흉내)
dist/tistory/  ← npm run build -w skin
  skin.html, index.xml, style.css, images/script.js
```

Vite 라이브러리 모드(IIFE, 고정 파일명). 티스토리는 스킨 파일을 `./images/`에서 서빙하므로 스크립트는 `images/script.js`.

## 화면과 치환자

| 영역 | 치환자 / 블록 | 비고 |
|---|---|---|
| 헤더 | `[##_title_##]`, `[##_blog_menu_##]`, `<s_search>` | 검색은 `[##_search_onclick_submit_##]`. 스크립트가 입력창에 하이브리드 검색 미리보기(2자 이상, 300ms 디바운스, 상위 3개)를 붙이고, 고른 결과가 없을 때 Enter는 티스토리 기본 검색 그대로 |
| 홈 히어로 | `[##_image_##]`, `[##_desc_##]` | `#tt-body-index`에서만 표시 |
| 목록 | `<s_list>`, `<s_list_rep>`, `<s_list_rep_thumbnail>` | 댓글 수는 0일 때 빈 값 → CSS `:empty`로 숨김 |
| 홈 카드 | `<s_index_article_rep>`, `<s_article_rep_thumbnail>` | |
| 본문 | `<s_permalink_article_rep>`, `[##_article_rep_desc_##]` | 본문 컨테이너 `#article-body` (수집기도 이 id를 씀) |
| 태그, 이전/다음, 카테고리 다른 글 | `<s_tag_label>`, `<s_article_prev/next>`, `<s_article_related>` | |
| 댓글 | `<s_rp>` + `[##_comment_group_##]` + 레거시 `<s_rp_container>`/`<s_rp_input_form>` | 아래 주의 참고 |
| 사이드바 | `<s_sidebar_element>`: 프로필, 카테고리, 인기 글, 방문자 수 | 글 본문 페이지에서는 숨김 |
| 챗봇 | `<div id="ai-assistant" data-api-base="https://…workers.dev">` | 위젯이 여기만 마운트 |

`<head>`에 이전 스킨에서 옮겨 온 것: 네이버 사이트 인증 메타, 애드센스 로더(`ca-pub-4884664384381875`).
수동 광고 단위 5개는 `skin.html`에 직접 넣었다 (슬롯 ID는 공개 HTML에 나가는 값이라 비밀 아님. `index.xml` 스킨 옵션으로 빼면 그 파일을 바꿀 때 스킨 설정이 모두 초기화되어 쓰지 않음).

| 단위 | 슬롯 | 위치 |
|---|---|---|
| 상단메인광고 | 8737680469 | 글 머리 아래 (시리즈 상자 다음) |
| 본문 | 9621702512 | 본문 끝, 태그 위 |
| display_adsense | 6278711115 | 목록/홈 페이지 번호 위 (`<s_paging>`) |
| 사이드광고1 | 9729513722 | 사이드바 위젯 아래 (`<s_sidebar>` 밖이라 사이드바 설정과 무관) |
| 사이드광고2 | 1625477204 | 그 아래, 스크롤 따라옴(sticky) |

글 본문 페이지는 사이드바를 숨기므로 사이드 광고는 홈/목록에서만 보인다. 숨겨진 사이드 광고는 `push()`하지 않는다 (보이지 않는 단위를 push하면 AdSense가 `No slot size for availableWidth=0` 오류). 채워지지 않은 단위(`data-ad-status="unfilled"`)는 CSS로 접는다.
`skin/test/build.test.js`가 5개가 정확히 한 번씩 있는지 확인한다.

## 티스토리에서 알게 된 주의점

- **댓글**: 이 블로그는 `[##_comment_group_##]`만 두면 빈 값이 나온다. 레거시 `<s_rp_container>` 등이 함께 있어야
  새 댓글 앱(`data-tistory-react-app="Comment"`)이 렌더링된다. 새 앱이 뜨면 CSS로 레거시 블록을 숨긴다.
- **댓글 다크 모드**: 티스토리 댓글 앱은 라이트 색상 고정 → `.tt-link-user`, `.tt_desc`, `.tt_date` 색을 토큰으로 덮어씀
- **방문자용 티스토리 툴바**(`.menu_toolbar`, 블로그 이름 + 구독하기): 티스토리가 `top:20px; right:20px`에 고정해 헤더 검색창을 가렸다 → `top: 77px`(헤더 65px 아래)로 내리고, 툴바가 있을 때만(`body:has(.menu_toolbar)`) 목차 sticky 위치를 120px로. 로그인한 주인에게는 툴바가 안 나오고, 폭 900px 이하에서는 티스토리가 스스로 숨긴다.
- **본문에 끼워 넣는 요소**: 광고 스크립트, 공감/공유 버튼(`.container_postbtn`), "카테고리의 다른 글"(`.another_category`). 목차는 이 블록들(`.another_category`, `.container_postbtn`, `.tt_box_namecard`) 안의 제목을 건너뛴다.
- **글 끝 "이 글과 비슷한 글"**: 이전/다음 글 위에 비슷한 글 3개 (`scripts/similar.js`, `/api/v1/posts/:id/similar`). 없거나 API 실패면 아무것도 안 그림.
- **로그인 상태의 `$ is not a function`**: 티스토리 `common.js`의 `toggleAdminLayer()`가 jQuery로 옛 스킨의 관리 메뉴(`.btn_etc`)를 찾는 코드. 방문자에게는 티스토리가 jQuery를 넣어 오류가 없고, 이 스킨엔 `.btn_etc`가 없어 동작 영향 없음. 주인만 보는 콘솔 오류라 jQuery(약 30KB)를 모두에게 싣지 않고 둔다.
  수집기는 이것들을 빼고 본문만 색인한다
- **스킨 편집기**: Monaco 에디터. 탭(HTML/CSS)을 바꾸면 모델이 새로 만들어진다
- **적용 버튼**: 화면 오른쪽 위 `button.btn-save` (x 1410~1488). 바로 옆을 눌러도 반응이 없으니 가운데를 누른다
- **같은 이름 파일 업로드**: 브라우저 기본 확인창("덮어쓸까요?")이 뜬다. 자동화로는 못 누르므로 사람이 확인

## 배포 (수동)

티스토리에 업로드 API가 없어 자동화하지 않았다 ([ADR 0006](adr/0006-skin-in-place-edit.md), [0007](adr/0007-ci-auto-deploy.md)).

1. `npm run build -w skin`
2. 티스토리 관리 → 꾸미기 → 스킨 편집 → HTML 편집
3. 바뀐 파일만 반영
   - HTML/CSS: 편집기에 붙여 넣기. 지금까지는 "직전에 반영한 내용과 같은지(해시)" 확인 후 바뀐 부분만 교체했다 → 그 사이 누가 고친 것을 덮어쓰지 않음
   - `images/script.js`: 파일업로드 탭에서 업로드 → 덮어쓰기 확인
4. **적용** 클릭
5. 확인: 블로그 HTML의 `style.css?_version_=` 값이 바뀌었는지, 새 CSS/JS 내용이 들어갔는지

처음 스킨을 바꿀 때는 기존 스킨을 **보관함에 백업**했다: "한눈에 스킨 백업 2026-10-16" (스킨 관리 → 스킨 보관함). 문제가 생기면 이걸로 되돌린다.

새로 설치하는 경우: `npm run zip -w skin` → `skin/dist/tistory-skin.zip`을 스킨 등록에 업로드.
`index.xml`의 `<default>` 값을 나중에 바꾸면 적용한 스킨 설정이 초기화될 수 있다.

## 로컬 확인

```bash
npm run dev -w skin   # http://localhost:5173 (목록), /post.html (본문)
```

Fixture는 실제 티스토리 렌더링을 흉내낼 뿐이다. 치환자 동작(댓글, 목록, 페이징)은 실제 블로그에서 확인한다.
위젯은 Fixture에서도 실제 API(`data-api-base`)를 호출한다 (CORS에 `http://localhost:5173` 허용).

## 위젯 동작

- 첫 열기: 글 본문 페이지면 비슷한 글, 아니면 최근 글 3개 + 예시 질문 버튼 4개
- 질문 → 결과 카드(카테고리, 한 줄 미리보기, 제목 새 탭 링크, [관련 문서]) + [더 보기]
- 링크는 `http(s)`만 표시 (`isSafeUrl`), 모든 텍스트는 React로 이스케이프
- Esc로 닫고 포커스를 버튼으로 돌려줌, 응답 영역 `aria-live="polite"`
- API 주소가 없으면(`data-api-base=""`) "준비 중" 표시, 입력 비활성
