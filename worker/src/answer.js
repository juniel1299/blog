// Q&A answer mode: a short Korean answer written only from the posts the hybrid search found, with
// [n] citations pointing at those posts. Model chosen by a bake-off on real posts (docs/rag-design.md, 답변 모드).
import { RESULT_LIMIT, searchPosts } from './search/search.js';

export const ANSWER_MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const NOT_FOUND = '블로그 글에서 답을 찾지 못했어요.';
const CONTEXT_CHARS_PER_POST = 1500;
const MAX_OUTPUT_TOKENS = 500;

const SYSTEM = `너는 '주니엘의 개발일지' 블로그의 도우미야. 아래 [출처]에 있는 내용만 근거로 질문에 한국어로 2~4문장으로 답해.
- 근거가 된 문장 끝에 출처 번호를 [1]처럼 붙여.
- 출처에 답이 없으면 다른 말 없이 정확히 "${NOT_FOUND}"라고만 답해.
- 출처에 없는 내용을 지어내지 마.`;

/**
 * One post's text for the prompt: from the chunk whose heading matched (else the top), in order,
 * cut at `maxChars`.
 * @param {{ position: number, heading: string | null, text: string }[]} chunks
 */
export function postContext(chunks, heading, maxChars = CONTEXT_CHARS_PER_POST) {
  const ordered = [...chunks].sort((a, b) => a.position - b.position);
  const start = Math.max(0, ordered.findIndex((chunk) => heading && chunk.heading === heading));
  return ordered
    .slice(start)
    .map((chunk) => (chunk.heading ? `${chunk.heading}\n${chunk.text}` : chunk.text))
    .join('\n')
    .slice(0, maxChars);
}

/** Model output -> { answer, cited source numbers }, dropping citations to sources that don't exist; null = no answer. */
export function cleanAnswer(raw, sourceCount) {
  const text = (raw ?? '').trim();
  if (!text || text.includes(NOT_FOUND)) return null;
  const cited = new Set();
  const answer = text
    .replace(/\[(\d+)\]/g, (marker, n) => {
      const index = Number(n);
      if (index < 1 || index > sourceCount) return '';
      cited.add(index);
      return marker;
    })
    .replace(/ +([.,])/g, '$1')
    .trim();
  return { answer, cited: [...cited].sort((a, b) => a - b) };
}

async function chunksByPost(env, postIds) {
  const { results } = await env.DB.prepare(
    `SELECT post_id, position, heading, text FROM post_chunks WHERE post_id IN (${postIds.map(() => '?').join(', ')})`,
  ).bind(...postIds).all();
  const byPost = new Map(postIds.map((id) => [id, []]));
  for (const row of results) byPost.get(row.post_id)?.push(row);
  return byPost;
}

const modelText = (out) => out?.response ?? out?.choices?.[0]?.message?.content;

/**
 * @returns {Promise<{ answer: string | null, sources: { postId, title, url, category, heading, preview, cited }[] }>}
 *   answer null when no post was found or the posts don't answer the question. Throws when the model fails.
 */
export async function answerQuestion(env, query) {
  const found = (await searchPosts(env, query)).slice(0, RESULT_LIMIT);
  if (found.length === 0) return { answer: null, sources: [] };

  const chunks = await chunksByPost(env, found.map((post) => post.postId));
  const context = found
    .map((post, i) => `[출처 ${i + 1}] ${post.title}\n${postContext(chunks.get(post.postId) ?? [], post.heading)}`)
    .join('\n\n');
  const out = await env.AI.run(ANSWER_MODEL, {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `${context}\n\n질문: ${query}` },
    ],
    max_tokens: MAX_OUTPUT_TOKENS,
    // Gemma 4 otherwise spends the whole budget on reasoning and returns no text.
    chat_template_kwargs: { enable_thinking: false },
  });

  const cleaned = cleanAnswer(modelText(out), found.length);
  const cited = new Set(cleaned?.cited ?? []);
  return {
    answer: cleaned?.answer ?? null,
    sources: found.map((post, i) => ({ ...post, cited: cited.has(i + 1) })),
  };
}
