/**
 * Search quality metrics over an eval set.
 * - hit@k: an expected post is among the returned results (results are already capped at 3)
 * - top1: the first result is an expected post
 * - falsePositive: an off-topic question (expect: []) returned anything
 * @param {{ query: string, expect: number[] }[]} cases
 * @param {Map<string, number[]>} returned query -> post ids in rank order
 */
export function scoreCases(cases, returned) {
  const rows = cases.map(({ query, expect }) => {
    const ids = returned.get(query) ?? [];
    const offTopic = expect.length === 0;
    return {
      query,
      expect,
      ids,
      offTopic,
      hit: offTopic ? ids.length === 0 : ids.some((id) => expect.includes(id)),
      top1: offTopic ? ids.length === 0 : expect.includes(ids[0]),
    };
  });
  const onTopic = rows.filter((row) => !row.offTopic);
  const offTopic = rows.filter((row) => row.offTopic);
  const rate = (list, key) => (list.length ? list.filter((row) => row[key]).length / list.length : 1);
  return {
    rows,
    summary: {
      cases: rows.length,
      hitAt3: rate(onTopic, 'hit'),
      top1: rate(onTopic, 'top1'),
      // share of off-topic questions that wrongly returned something
      falsePositiveRate: 1 - rate(offTopic, 'hit'),
    },
  };
}

export const THRESHOLDS = { hitAt3: 0.85, top1: 0.7, falsePositiveRate: 0.2 };

/** Names of metrics that fall short of THRESHOLDS (empty = pass). */
export function failures(summary, thresholds = THRESHOLDS) {
  return [
    summary.hitAt3 < thresholds.hitAt3 && 'hitAt3',
    summary.top1 < thresholds.top1 && 'top1',
    summary.falsePositiveRate > thresholds.falsePositiveRate && 'falsePositiveRate',
  ].filter(Boolean);
}
