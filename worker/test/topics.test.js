import { describe, expect, test } from 'vitest';
import { EMBEDDING_MODEL } from '../src/ingest/run.js';
import { clusterQuestions, gapType, topicReport } from '../src/topics.js';

const item = (query, count, kinds = {}) => ({ query, count, kinds: { asked: 0, miss: 0, disliked: 0, lowClick: 0, ...kinds } });

describe('clusterQuestions', () => {
  test('groups questions whose vectors point the same way; label is the most asked wording', () => {
    const items = [item('리액트 상태관리', 5, { asked: 5 }), item('쿠버네티스 배포', 3, { miss: 3 }), item('리액트 상태 관리 방법', 2, { asked: 1, disliked: 1 })];
    const vectors = [[1, 0.05], [0, 1], [0.98, 0.1]];
    const clusters = clusterQuestions(items, vectors, 0.9);
    expect(clusters.map((c) => [c.label, c.count, c.examples])).toEqual([
      ['리액트 상태관리', 7, ['리액트 상태관리', '리액트 상태 관리 방법']],
      ['쿠버네티스 배포', 3, ['쿠버네티스 배포']],
    ]);
    expect(clusters[0].kinds).toEqual({ asked: 6, miss: 0, disliked: 1, lowClick: 0 });
  });

  test('below the threshold, questions stay apart', () => {
    const clusters = clusterQuestions([item('a', 1), item('b', 1)], [[1, 0], [0.6, 0.8]], 0.9);
    expect(clusters).toHaveLength(2);
  });
});

describe('gapType', () => {
  test.each([
    ['only asked and answered fine', { asked: 4, miss: 0, disliked: 0, lowClick: 0 }, 0.9, null],
    ['nothing close in the blog', { asked: 0, miss: 3, disliked: 0, lowClick: 0 }, 0.4, 'new'],
    ['close post exists but readers were unhappy', { asked: 2, miss: 0, disliked: 1, lowClick: 0 }, 0.7, 'improve'],
    ['no vector match at all', { asked: 0, miss: 1, disliked: 0, lowClick: 0 }, null, 'new'],
  ])('%s', (_name, kinds, nearestScore, expected) => {
    expect(gapType(kinds, nearestScore)).toBe(expected);
  });
});

describe('topicReport', () => {
  // three unrelated topics: orthogonal vectors
  const vectorOf = { '리액트 상태관리': [1, 0, 0], '쿠버네티스 배포': [0, 1, 0], '자바 람다': [0, 0, 1] };
  function env() {
    return {
      AI: { run: async (model, { text }) => (model === EMBEDDING_MODEL ? { data: text.map((t) => vectorOf[t] ?? [0.5, 0.5, 0]) } : null) },
      VECTORIZE: {
        query: async (vector) => ({
          // the k8s topic has nothing close; others match post 119 well
          matches: vector[1] > 0.9 ? [{ id: '5-0', score: 0.41 }] : [{ id: '119-2', score: 0.72 }],
        }),
      },
      DB: {
        prepare: (sql) => ({
          bind: () => ({
            all: async () => {
              if (sql.includes('/* topic_questions */')) return { results: [{ query: '리액트 상태관리', n: 5 }] };
              if (sql.includes('/* topic_clicks */')) return { results: [{ query: '리액트 상태관리', clicks: 4 }] };
              if (sql.includes('FROM search_misses')) return { results: [{ query: '쿠버네티스 배포', count: 3, last_seen: 'x' }] };
              if (sql.includes('GROUP BY vote')) return { results: [] };
              if (sql.includes('FROM search_feedback')) return { results: [{ query: '자바 람다', down: 2, up: 0, last_post_ids: '[47]', last_seen: 'x' }] };
              if (sql.includes('FROM posts WHERE id IN')) return { results: [{ id: 119, title: 'Redux vs Zustand', url: 'https://b/119' }, { id: 5, title: '자바 기초', url: 'https://b/5' }] };
              return { results: [] };
            },
          }),
        }),
      },
    };
  }

  test('ranks topics and lists gaps as new-post or improve-post candidates with the closest post', async () => {
    const report = await topicReport(env(), 30);
    expect(report.topics.map((t) => [t.label, t.count])).toEqual([
      ['리액트 상태관리', 5],
      ['쿠버네티스 배포', 3],
      ['자바 람다', 2],
    ]);
    expect(report.gaps).toEqual([
      expect.objectContaining({ label: '쿠버네티스 배포', type: 'new', nearest: { postId: 5, title: '자바 기초', url: 'https://b/5', score: 0.41 } }),
      expect.objectContaining({ label: '자바 람다', type: 'improve', nearest: { postId: 119, title: 'Redux vs Zustand', url: 'https://b/119', score: 0.72 } }),
    ]);
  });

  test('no questions: empty report without calling the model', async () => {
    const e = env();
    let called = false;
    e.AI.run = async () => {
      called = true;
    };
    e.DB.prepare = () => ({ bind: () => ({ all: async () => ({ results: [] }) }) });
    expect(await topicReport(e, 7)).toEqual({ topics: [], gaps: [] });
    expect(called).toBe(false);
  });
});
