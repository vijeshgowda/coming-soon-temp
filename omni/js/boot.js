// Omni — boot script (theme toggle + service worker registration)
// Extracted from an inline <script> so the page can ship a strict
// Content-Security-Policy without allowing 'unsafe-inline' scripts.
(function () {
  // Language — set <html lang> early so assistive tech is correct before the
  // app module loads and translates the markup. (Text is translated by app.js.)
  try {
    const lang = localStorage.getItem('omni-lang');
    if (lang) document.documentElement.lang = lang;
  } catch { /* no localStorage */ }

  // Theme toggle
  const saved = localStorage.getItem('omni-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = saved === 'light' ? '#f8faf8' : '#0c0a09';

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.textContent = saved === 'light' ? '☀️' : '🌙';

    btn.addEventListener('click', () => {
      document.documentElement.classList.add('theme-transitioning');
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('omni-theme', next);
      btn.textContent = next === 'light' ? '☀️' : '🌙';
      if (meta) meta.content = next === 'light' ? '#f8faf8' : '#0c0a09';
      setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 350);
    });
  });

  // Service Worker — relative path registers /omni/sw.js with scope /omni/,
  // so it only controls this sub-app and not sibling apps at the repo root.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
