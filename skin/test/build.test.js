// @vitest-environment node
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { build } from 'vite';

const skinRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = ['skin.html', 'index.xml', 'style.css', 'images/script.js'];
const SUBSTITUTIONS = ['[##_title_##]', '[##_article_rep_desc_##]', '<s_t3>', '<s_search>', '<s_paging_rep>'];

let outDir;

beforeAll(async () => {
  outDir = await mkdtemp(path.join(tmpdir(), 'tistory-skin-'));
  await build({ root: skinRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
}, 60_000);

afterAll(async () => {
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

describe('tistory build output', () => {
  test.each(REQUIRED)('emits %s', async (file) => {
    expect((await stat(path.join(outDir, file))).size).toBeGreaterThan(0);
  });

  test('skin.html is copied byte-for-byte with substitution tags intact', async () => {
    const source = await readFile(path.join(skinRoot, 'tistory/skin.html'), 'utf8');
    const built = await readFile(path.join(outDir, 'skin.html'), 'utf8');
    expect(built).toBe(source);
    for (const tag of SUBSTITUTIONS) expect(built).toContain(tag);
  });

  test('skin.html references the fixed asset names', async () => {
    const built = await readFile(path.join(outDir, 'skin.html'), 'utf8');
    expect(built).toContain('href="./style.css"');
    expect(built).toContain('src="./images/script.js"');
  });
});
