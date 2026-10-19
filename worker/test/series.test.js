import { describe, expect, test } from 'vitest';
import worker from '../src/index.js';
import { seriesOf } from '../src/posts.js';

describe('seriesOf (real titles)', () => {
  test.each([
    ['[React] 7. useEffect', { key: 'react', name: 'React', order: 7 }],
    ['[React] 3. 상태 (State) [Props와 이어집니다.]', { key: 'react', name: 'React', order: 3 }],
    ['[캡스톤디자인] 프롤로그 - 0', { key: '캡스톤디자인', name: '캡스톤디자인', order: 0 }],
    ['[캡스톤디자인] 동작 방식 - 2  (도망치는 건 부끄럽지만 도움이 된다)', { key: '캡스톤디자인', name: '캡스톤디자인', order: 2 }],
  ])('%s', (title, expected) => {
    expect(seriesOf(title)).toEqual(expected);
  });

  test.each(['[React] useState 는 왜 직접 값을 넣지 않을까 ?', '[Oracle SQL] Index 란? (ft. 뭐든 과하면 독이다)', '자바의 연산자(Operator)-1', '[JAVA]자료형 변환'])(
    'not a series: %s',
    (title) => {
      expect(seriesOf(title)).toBeNull();
    },
  );
});

describe('GET /api/v1/posts/:id/series', () => {
  const rows = [
    { id: 97, title: '[React] 6. 생명주기', url: 'https://b/97' },
    { id: 98, title: '[React] 7. useEffect', url: 'https://b/98' },
    { id: 110, title: '[React] useState 는 왜', url: 'https://b/110' },
    { id: 96, title: '[React] 5. Hook', url: 'https://b/96' },
  ];
  const env = { DB: { prepare: () => ({ all: async () => ({ results: rows }) }) } };
  const get = (id) => worker.fetch(new Request(`https://api.test/api/v1/posts/${id}/series`), env, {});

  test('episodes in order, non-episode posts left out', async () => {
    const body = await (await get(98)).json();
    expect(body.series.name).toBe('React');
    expect(body.series.posts.map((p) => p.postId)).toEqual([96, 97, 98]);
  });

  test('null for a post outside any series, 404 for an unknown post', async () => {
    expect((await (await get(110)).json()).series).toBeNull();
    expect((await get(5)).status).toBe(404);
  });
});
