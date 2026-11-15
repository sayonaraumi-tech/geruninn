// Shared page readiness for browser tests after CSS extraction.
// Waits for stylesheets and critical computed styles; fails with clear error on timeout.
const {setTimeout: delay} = require('node:timers/promises');

async function waitForPageReady(page, {timeout = 10000} = {}) {
  const start = Date.now();
  const deadline = start + timeout;
  while (Date.now() < deadline) {
    try {
      const ready = await page.evaluate(() => {
        const sheets = [...document.styleSheets];
        const cssLoaded = sheets.some(s => s.href && s.href.includes('main.css') && s.cssRules && s.cssRules.length > 0);
        const modal = document.getElementById('bizEventModal');
        const modalHidden = !modal || getComputedStyle(modal).display === 'none';
        const status = document.getElementById('cloudStatus');
        const statusReady = status && status.textContent.trim().length > 0;
        return cssLoaded && modalHidden && statusReady;
      });
      if (ready) return;
    } catch (_) {}
    await delay(50);
  }
  const diag = await page.evaluate(() => ({
    sheets: [...document.styleSheets].map(s => ({href: s.href, rules: s.cssRules ? s.cssRules.length : 0})),
    modalDisplay: document.getElementById('bizEventModal') ? getComputedStyle(document.getElementById('bizEventModal')).display : 'missing',
    status: document.getElementById('cloudStatus') ? document.getElementById('cloudStatus').textContent : 'missing'
  })).catch(e => ({error: e.message}));
  throw new Error(`Page not ready within ${timeout}ms. Diagnostics: ${JSON.stringify(diag)}`);
}

module.exports = {waitForPageReady};
