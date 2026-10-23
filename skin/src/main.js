import './styles/main.css';
import { initPageBeacon } from './scripts/analytics.js';
import { initCodeBlocks } from './scripts/code-blocks.js';
import { initHeaderSearch } from './scripts/header-search.js';
import { initPostMeta } from './scripts/post-meta.js';
import { initReadProgress } from './scripts/read-progress.js';
import { initSeries } from './scripts/series.js';
import { initThemeToggle } from './scripts/theme.js';
import { initToc } from './scripts/toc.js';
import { initTopButton } from './scripts/top-button.js';
import { currentPostId, mountWidget } from './widget/mount.jsx';

function start() {
  initThemeToggle(document.querySelector('[data-theme-toggle]'));
  initTopButton(document.querySelector('[data-top-button]'));
  const article = document.getElementById('article-body');
  initToc(document.querySelector('[data-toc]'), article);
  initReadProgress(document.querySelector('[data-read-progress]'), article);
  initCodeBlocks(article);
  initPostMeta(document.querySelector('.post-meta'), article);
  const assistant = document.getElementById('ai-assistant');
  const apiBase = assistant?.dataset.apiBase ?? '';
  const postId = currentPostId(window.location, document.body.id);
  initHeaderSearch(document.getElementById('search-input'), apiBase);
  initSeries(document.querySelector('.post-header'), apiBase, postId);
  initPageBeacon({ apiBase, postId, article });
  mountWidget(assistant);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
