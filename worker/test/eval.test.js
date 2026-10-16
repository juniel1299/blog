import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { failures, scoreCases } from '../eval/score.js';

describe('scoreCases', () => {
  const cases = [
    { query: 'a', expect: [1] },
    { query: 'b', expect: [2, 3] },
    { query: 'c', expect: [4] },
    { query: 'off1', expect: [] },
    { query: 'off2', expect: [] },
  ];

  test('hit@3, top1 and off-topic false positives', () => {
    const returned = new Map([
      ['a', [1, 9]], // hit + top1
      ['b', [9, 3]], // hit, not top1
      ['c', [9]], // miss
      ['off1', []], // correct "nothing"
      ['off2', [7]], // false positive
    ]);
    const { summary, rows } = scoreCases(cases, returned);
    expect(summary).toEqual({ cases: 5, hitAt3: 2 / 3, top1: 1 / 3, falsePositiveRate: 0.5 });
    expect(rows.map((r) => r.hit)).toEqual([true, true, false, true, false]);
  });

  test('failures lists metrics below thresholds', () => {
    expect(failures({ hitAt3: 0.9, top1: 0.8, falsePositiveRate: 0 })).toEqual([]);
    expect(failures({ hitAt3: 0.5, top1: 0.5, falsePositiveRate: 0.5 })).toEqual(['hitAt3', 'top1', 'falsePositiveRate']);
  });
});

describe('search-cases.json', () => {
  const cases = JSON.parse(readFileSync(new URL('../eval/search-cases.json', import.meta.url), 'utf8'));

  test('well-formed: unique queries, numeric expected ids, has off-topic cases', () => {
    expect(new Set(cases.map((c) => c.query)).size).toBe(cases.length);
    expect(cases.every((c) => typeof c.query === 'string' && Array.isArray(c.expect) && c.expect.every(Number.isInteger))).toBe(true);
    expect(cases.filter((c) => c.expect.length === 0).length).toBeGreaterThanOrEqual(3);
  });
});
