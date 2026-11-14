// AI 3-line summary shown at the top of each post. Written once per post version by Workers AI when the
// post is indexed (ingest/run.js), stored in posts.ai_summary (migration 0009); POST /admin/summaries
// fills in posts indexed before this existed.
import { ANSWER_MODEL } from './answer.js';

const MAX_LINES = 3;
const MIN_LINES = 2;
const MAX_LINE_CHARS = 120;
const MAX_INPUT_CHARS = 3000;
const MAX_OUTPUT_TOKENS = 300;

const SYSTEM = `너는 개발 블로그 글을 요약하는 도우미야. 주어진 글만 근거로 핵심을 한국어 세 줄로 요약해.
- 각 줄은 "- "로 시작하는 한 문장, 50자 안팎.
- 글에 없는 내용은 쓰지 말고, 요약 외에 다른 말은 쓰지 마.`;

/** Model output -> up to 3 lines, or null when it isn't a usable summary. */
export function parseSummary(raw) {
  const lines = (raw ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, MAX_LINES)
    .map((line) => line.slice(0, MAX_LINE_CHARS));
  return lines.length >= MIN_LINES ? lines : null;
}

/** 3 lines for one post, or null (model failure or unusable output never fails indexing). */
export async function summarizePost(env, title, text) {
  try {
    const out = await env.AI.run(ANSWER_MODEL, {
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `제목: ${title}\n\n본문:\n${text.slice(0, MAX_INPUT_CHARS)}` },
      ],
      max_tokens: MAX_OUTPUT_TOKENS,
      // Gemma 4 otherwise spends the whole budget on reasoning and returns no text.
      chat_template_kwargs: { enable_thinking: false },
    });
    return parseSummary(out?.response ?? out?.choices?.[0]?.message?.content);
  } catch (error) {
    console.error(JSON.stringify({ event: 'summary_failed', error: String(error) }));
    return null;
  }
}

/** The post body as indexed, for summarizing: headings and text in order. */
async function postText(env, postId) {
  const { results } = await env.DB.prepare('SELECT heading, text FROM post_chunks WHERE post_id = ? ORDER BY position').bind(postId).all();
  return results.map((row) => (row.heading ? `${row.heading}\n${row.text}` : row.text)).join('\n');
}

/** Summarizes up to `limit` indexed posts that have none yet. */
export async function backfillSummaries(env, limit) {
  const { results } = await env.DB.prepare(
    "SELECT id, title FROM posts WHERE status = 'indexed' AND ai_summary IS NULL ORDER BY id DESC LIMIT ?",
  ).bind(limit).all();
  let done = 0;
  for (const post of results) {
    const lines = await summarizePost(env, post.title, await postText(env, post.id));
    if (!lines) continue;
    await env.DB.prepare('UPDATE posts SET ai_summary = ? WHERE id = ?').bind(JSON.stringify(lines), post.id).run();
    done += 1;
  }
  const left = await env.DB.prepare("SELECT count(*) AS n FROM posts WHERE status = 'indexed' AND ai_summary IS NULL").bind().first();
  return { done, remaining: left?.n ?? 0 };
}

/** Stored lines; null when not generated yet; undefined when the post isn't indexed. */
export async function storedSummary(env, postId) {
  const row = await env.DB.prepare("SELECT ai_summary FROM posts WHERE id = ? AND status = 'indexed'").bind(postId).first();
  if (!row) return undefined;
  try {
    return row.ai_summary ? JSON.parse(row.ai_summary) : null;
  } catch {
    return null;
  }
}
