// Runs the search eval set against a deployed Worker and prints per-query results + metrics.
// Uses GET /admin/search-debug (no response cache, no rate limit), so it needs ADMIN_TOKEN:
// from the environment, else from worker/.dev.vars.
//   npm run eval:search -w worker                  # live Worker
//   EVAL_API=http://localhost:8787 npm run eval:search -w worker
import { readFileSync } from 'node:fs';
import { failures, scoreCases } from './score.js';

const API = process.env.EVAL_API ?? 'https://tistory-ai-assistant-api.youngs5440.workers.dev';

function adminToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  try {
    const vars = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
    return vars.match(/^ADMIN_TOKEN=(.+)$/m)?.[1].trim();
  } catch {
    return undefined;
  }
}

async function pickedPostIds(token, query) {
  const res = await fetch(`${API}/admin/search-debug?q=${encodeURIComponent(query)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for "${query}" (wrong ADMIN_TOKEN or API?)`);
  return (await res.json()).picked.map((hit) => hit.postId);
}

const token = adminToken();
if (!token) {
  console.error('ADMIN_TOKEN not set (env or worker/.dev.vars)');
  process.exit(2);
}

const cases = JSON.parse(readFileSync(new URL('./search-cases.json', import.meta.url), 'utf8'));
const returned = new Map();
for (const { query } of cases) returned.set(query, await pickedPostIds(token, query));

const { rows, summary } = scoreCases(cases, returned);
for (const row of rows) {
  const mark = row.hit ? (row.top1 ? 'OK ' : 'ok ') : 'MISS';
  console.log(`${mark} ${row.query.padEnd(24)} expect=${JSON.stringify(row.expect)} got=${JSON.stringify(row.ids)}`);
}
const pct = (n) => `${(n * 100).toFixed(0)}%`;
console.log(
  `\n${summary.cases} cases | hit@3 ${pct(summary.hitAt3)} | top1 ${pct(summary.top1)} | off-topic false positives ${pct(summary.falsePositiveRate)}`,
);
const failed = failures(summary);
if (failed.length) {
  console.error(`below threshold: ${failed.join(', ')}`);
  process.exit(1);
}
