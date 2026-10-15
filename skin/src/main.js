import './styles/main.css';
import { initThemeToggle } from './scripts/theme.js';
import { initToc } from './scripts/toc.js';
import { initTopButton } from './scripts/top-button.js';
import { mountWidget } from './widget/mount.jsx';

function start() {
  initThemeToggle(document.querySelector('[data-theme-toggle]'));
  initTopButton(document.querySelector('[data-top-button]'));
  initToc(document.querySelector('[data-toc]'), document.getElementById('article-body'));
  mountWidget(document.getElementById('ai-assistant'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
