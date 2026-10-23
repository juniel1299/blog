// Insight dashboard: reads GET /admin/insights with the admin token kept in this browser only.
// Question and keyword text comes from visitors, so everything is rendered with textContent.
const TOKEN_KEY = 'insightsAdminToken';
const SOURCE_LABELS = {
  direct: '직접 방문',
  internal: '블로그 안 이동',
  naver: '네이버',
  daum: '다음',
  google: '구글',
  bing: '빙',
  zum: '줌',
  duckduckgo: '덕덕고',
  other: '다른 사이트',
};
const CLICK_LABELS = { chat: '챗봇 검색', answer: 'AI 답변', list: '처음 목록', header: '헤더 검색' };

const $ = (selector) => document.querySelector(selector);
const percent = (value) => `${Math.round(value * 100)}%`;
const number = (value) => Number(value ?? 0).toLocaleString('ko-KR');

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the token lives only in memory for this visit.
  }
}

/**
 * Small DOM builder: text is always textContent, never HTML. Sizes go through node.style (CSSOM), which the
 * page CSP allows, unlike style="" attributes.
 */
function el(tag, { className, text, attrs, style } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [key, value] of Object.entries(attrs ?? {})) node.setAttribute(key, value);
  Object.assign(node.style, style);
  node.append(...children);
  return node;
}

function postLink(post) {
  const safe = /^https:\/\//.test(post.url ?? '');
  return safe ? el('a', { text: post.title, attrs: { href: post.url, target: '_blank', rel: 'noopener noreferrer' } }) : el('span', { text: post.title });
}

function section(title, hint, body) {
  return el('section', { className: 'card' }, [
    el('h2', { text: title }),
    ...(hint ? [el('p', { className: 'muted hint', text: hint })] : []),
    body,
  ]);
}

const empty = (text = '아직 데이터가 없어요.') => el('p', { className: 'empty', text });

function table(headers, rows) {
  if (rows.length === 0) return empty();
  return el('div', { className: 'table-wrap' }, [
    el('table', {}, [
      el('thead', {}, [el('tr', {}, headers.map((h) => el('th', { text: h, attrs: { scope: 'col' } })))]),
      el('tbody', {}, rows.map((cells) => el('tr', {}, cells.map((cell) => el('td', {}, [typeof cell === 'object' ? cell : String(cell)]))))),
    ]),
  ]);
}

/** Horizontal bars for "label: count" lists. */
function bars(items) {
  if (items.length === 0) return empty();
  const max = Math.max(...items.map((item) => item.n), 1);
  return el('ul', { className: 'bars' }, items.map((item) =>
    el('li', {}, [
      el('span', { className: 'bar-label', text: item.label }),
      el('span', { className: 'bar-track' }, [el('span', { className: 'bar-fill', style: { width: `${(item.n / max) * 100}%` } })]),
      el('span', { className: 'bar-value', text: number(item.n) }),
    ]),
  ));
}

function dailyChart(daily) {
  if (daily.length === 0) return empty();
  const max = Math.max(...daily.map((d) => d.views), 1);
  return el('div', { className: 'chart', attrs: { role: 'img', 'aria-label': daily.map((d) => `${d.day} ${d.views}회`).join(', ') } },
    daily.map((d) =>
      el('div', { className: 'col', attrs: { title: `${d.day}: ${d.views}회` } }, [
        el('span', { className: 'col-value', text: number(d.views) }),
        el('span', { className: 'col-bar', style: { height: `${(d.views / max) * 100}%` } }),
        el('span', { className: 'col-day', text: d.day.slice(5) }),
      ]),
    ),
  );
}

function summaryCards(s) {
  const stats = [
    ['조회', number(s.views)],
    ['평균 머문 시간', `${number(s.avgSeconds)}초`],
    ['평균 읽은 깊이', `${s.avgDepth}%`],
    ['끝까지 읽음 (75%+)', percent(s.readThroughRate)],
    ['챗봇 질문', `${number(s.questions)} (AI 답변 ${number(s.answers)})`],
    ['카드 클릭', number(s.clicks)],
    ['결과 0건 질문', number(s.misses)],
    ['👍 / 👎', `${number(s.up)} / ${number(s.down)}`],
  ];
  return el('div', { className: 'stats' }, stats.map(([label, value]) =>
    el('div', { className: 'stat' }, [el('span', { className: 'stat-label', text: label }), el('strong', { text: value })]),
  ));
}

const change = (value) => el('span', { className: value > 0 ? 'up' : value < 0 ? 'down' : 'muted', text: value > 0 ? `+${value}` : String(value) });

function render(report) {
  const root = $('[data-report]');
  root.replaceChildren(
    summaryCards(report.summary),
    el('div', { className: 'grid' }, [
      section('일별 조회', '한국 시간 기준', dailyChart(report.daily)),
      section('급상승 글', `지난 ${report.days}일과 그 전 ${report.days}일 비교, 2회 이상 조회된 글`,
        report.rising.length ? el('ol', { className: 'rising' }, report.rising.map((p) => el('li', {}, [postLink(p), el('span', { className: 'up', text: ` +${p.change}` })]))) : empty('뚜렷하게 늘어난 글이 아직 없어요.')),
    ]),
    section('글별 성과', '끝까지 읽음 = 본문 75% 이상까지 스크롤한 방문 비율', table(
      ['글', '조회', '변화', '평균 시간', '끝까지 읽음', '챗봇 클릭'],
      report.posts.map((p) => [postLink(p), number(p.views), change(p.change), `${p.avgSeconds}초`, percent(p.readRate), number(p.chatClicks)]),
    )),
    el('div', { className: 'grid' }, [
      section('유입 경로', null, bars(report.sources.map((s) => ({ label: SOURCE_LABELS[s.source] ?? s.source, n: s.n })))),
      section('다른 사이트에서 온 방문', null, bars(report.referrers.map((r) => ({ label: r.host, n: r.n })))),
    ]),
    section('검색 유입 키워드', '네이버·다음·빙 등이 넘겨준 검색어 (구글은 검색어를 숨김)', table(
      ['검색어', '검색엔진', '방문'],
      report.keywords.map((k) => [k.query, SOURCE_LABELS[k.engine] ?? k.engine, number(k.n)]),
    )),
    section('많이 묻는 질문', '클릭률 = 결과 카드를 누른 비율. 낮으면 결과가 기대와 다를 수 있어요', table(
      ['질문', '횟수', 'AI 답변', '클릭', '클릭률'],
      report.questions.map((q) => [q.query, number(q.count), number(q.answers), number(q.clicks), percent(q.clickRate)]),
    )),
    el('div', { className: 'grid' }, [
      section('결과 0건 질문', '블로그에 없는 주제일 수 있어요: 다음 글 후보', table(['질문', '횟수'], report.misses.map((m) => [m.query, number(m.count)]))),
      section('👎 받은 질문', '검색 결과가 질문과 맞지 않았던 경우', table(['질문', '👎', '👍'], report.disliked.map((d) => [d.query, number(d.down), number(d.up)]))),
    ]),
    section('클릭이 나온 곳', null, bars(report.clickSources.map((c) => ({ label: CLICK_LABELS[c.source] ?? c.source, n: c.n })))),
  );
  root.hidden = false;
}

function showLogin(message = '') {
  $('[data-login]').hidden = false;
  $('[data-controls]').hidden = true;
  $('[data-report]').hidden = true;
  $('[data-status]').textContent = '';
  $('[data-login-error]').textContent = message;
  $('#token').focus();
}

async function load(days) {
  const token = readToken();
  if (!token) return showLogin();
  $('[data-login]').hidden = true;
  $('[data-controls]').hidden = false;
  $('[data-status]').textContent = '불러오는 중…';
  let res;
  try {
    res = await fetch(`/admin/insights?days=${days}`, { headers: { authorization: `Bearer ${token}` } });
  } catch {
    $('[data-status]').textContent = '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.';
    return;
  }
  // The admin API answers 404 to a wrong token so it does not reveal itself.
  if (res.status === 404) {
    saveToken('');
    return showLogin('토큰이 맞지 않아요.');
  }
  if (!res.ok) {
    $('[data-status]').textContent = `불러오지 못했어요 (HTTP ${res.status}).`;
    return;
  }
  render(await res.json());
  $('[data-status]').textContent = `최근 ${days}일 · ${new Date().toLocaleString('ko-KR')} 기준`;
}

let currentDays = 7;

$('[data-login]').addEventListener('submit', (event) => {
  event.preventDefault();
  saveToken($('#token').value.trim());
  $('#token').value = '';
  load(currentDays);
});

$('[data-logout]').addEventListener('click', () => {
  saveToken('');
  showLogin();
});

for (const button of document.querySelectorAll('[data-days]')) {
  button.addEventListener('click', () => {
    currentDays = Number(button.dataset.days);
    for (const other of document.querySelectorAll('[data-days]')) other.setAttribute('aria-pressed', String(other === button));
    load(currentDays);
  });
}

load(currentDays);
