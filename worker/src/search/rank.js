const RRF_K = 60;

/** "122-3" -> 122 */
export function postIdOf(chunkId) {
  return Number(chunkId.split('-')[0]);
}

/**
 * Relevance gate before fusion (thresholds calibrated on real posts, see docs/architecture.md 검색):
 * - title/heading keyword hits always count (precise signal);
 * - body-only keyword hits count only if the post is at least loosely related semantically,
 *   otherwise common words ("오늘", "방법") drag in unrelated posts;
 * - vector hits count on their own above the strict floor.
 * @param {{ strong: string[], body: string[], vector: { id: string, score: number }[] }} candidates
 * @returns {string[][]} rankings for fuseRankings
 */
export function selectRankings({ strong, body, vector }, { strictFloor, looseFloor }) {
  const looselyRelated = new Set(vector.filter((m) => m.score >= looseFloor).map((m) => postIdOf(m.id)));
  return [
    strong,
    body.filter((id) => looselyRelated.has(postIdOf(id))),
    vector.filter((m) => m.score >= strictFloor).map((m) => m.id),
  ];
}

/**
 * Reciprocal Rank Fusion over ranked chunk-id lists, then one entry per post (its best chunk).
 * @param {string[][]} rankings each list ordered best-first
 * @param {number} limit max posts
 * @returns {{ postId: number, chunkId: string, score: number }[]}
 */
export function fuseRankings(rankings, limit) {
  const chunkScores = new Map();
  for (const list of rankings) {
    list.forEach((chunkId, rank) => {
      chunkScores.set(chunkId, (chunkScores.get(chunkId) ?? 0) + 1 / (RRF_K + rank + 1));
    });
  }
  const bestPerPost = new Map();
  for (const [chunkId, score] of chunkScores) {
    const postId = postIdOf(chunkId);
    const best = bestPerPost.get(postId);
    if (!best || score > best.score) bestPerPost.set(postId, { postId, chunkId, score });
  }
  return [...bestPerPost.values()].sort((a, b) => b.score - a.score || a.postId - b.postId).slice(0, limit);
}
