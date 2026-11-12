const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const cssDir = path.join(__dirname, '..', 'css');
const fixture = `
  <div class="tsuki-ui">
    <div class="tsuki-shell">
      <nav class="tsuki-topbar">月輪合同会社</nav>
      <main class="tsuki-workspace">
        <h1 class="tsuki-page-title">売上・入金</h1>
        <h2 class="tsuki-section-title">売上一覧</h2>
        <p class="tsuki-help">金額は税込です。</p>
        <div class="tsuki-table-scroll">
          <table class="tsuki-table">
            <thead><tr><th scope="col">摘要</th><th scope="col" class="tsuki-amount">金額</th></tr></thead>
            <tbody><tr><td>工事</td><td class="tsuki-amount">¥85,000</td></tr></tbody>
          </table>
        </div>
        <label for="filter">摘要</label><input id="filter" class="tsuki-input">
        <button class="tsuki-button tsuki-button--primary">検索</button>
        <button class="tsuki-button tsuki-button--primary" disabled>保存</button>
        <span class="tsuki-status tsuki-status--warning">要確認</span>
      </main>
    </div>
  </div>
  <div id="outside"><button class="tsuki-button tsuki-button--primary">印刷</button></div>
`;

async function style(page, selector, ...properties) {
  return page.locator(selector).evaluate((element, keys) => {
    const computed = getComputedStyle(element);
    return keys.map(key => computed.getPropertyValue(key));
  }, properties);
}

async function test() {
  const browser = await chromium.launch();
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(fixture);
      const outside = await style(page, '#outside button', 'background-color', 'font-family', 'min-block-size');

      await page.emulateMedia({ media: 'print' });
      const printStyle = () => style(page, '.tsuki-topbar', 'background-color', 'font-family', 'padding');
      const beforePrint = await printStyle();
      await page.addStyleTag({ path: path.join(cssDir, 'design-tokens.css') });
      await page.addStyleTag({ path: path.join(cssDir, 'ui-foundation.css') });
      assert.deepEqual(await printStyle(), beforePrint);
      assert.deepEqual(await style(page, '.tsuki-ui', '--tsuki-nav'), ['']);

      await page.emulateMedia({ media: 'screen' });
      assert.deepEqual(await style(page, '#outside button', 'background-color', 'font-family', 'min-block-size'), outside);
      assert.deepEqual(await style(page, '.tsuki-shell', 'background-color'), ['rgb(242, 243, 245)']);
      assert.deepEqual(await style(page, '.tsuki-topbar', 'background-color'), ['rgb(23, 23, 23)']);
      assert.deepEqual(await style(page, '.tsuki-workspace', 'background-color', 'padding'), ['rgb(255, 255, 255)', '16px']);
      assert.match((await style(page, '.tsuki-workspace', 'font-family'))[0], /^"Noto Sans JP"/);
      assert.deepEqual(await style(page, 'h1', 'font-size', 'font-weight'), ['22px', '700']);
      assert.deepEqual(await style(page, 'h2', 'font-size', 'font-weight'), ['17px', '600']);
      assert.deepEqual(await style(page, '.tsuki-help', 'font-size'), ['12px']);
      assert.deepEqual(await style(page, 'thead tr', 'height'), ['40px']);
      assert.deepEqual(await style(page, 'th.tsuki-amount', 'font-size', 'text-align'), ['13px', 'right']);
      assert.deepEqual(await style(page, 'td.tsuki-amount', 'font-size', 'text-align', 'font-variant-numeric'), ['14px', 'right', 'tabular-nums']);
      assert.deepEqual(await style(page, '.tsuki-input', 'min-block-size'), ['36px']);
      assert.deepEqual(await style(page, '.tsuki-workspace .tsuki-button:enabled', 'min-block-size', 'background-color'), ['36px', 'rgb(181, 150, 76)']);
      assert.deepEqual(await style(page, '.tsuki-button:disabled', 'background-color'), ['rgb(242, 243, 245)']);
      assert.deepEqual(await style(page, '.tsuki-status--warning', 'background-color'), ['rgb(255, 246, 223)']);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), '検索');
      assert.deepEqual(await style(page, ':focus-visible', 'outline-width'), ['2px']);
      await page.locator('.tsuki-workspace .tsuki-button:enabled').hover();
      assert.deepEqual(await style(page, '.tsuki-workspace .tsuki-button:enabled', 'background-color'), ['rgb(169, 134, 57)']);
      await page.close();
      console.log(`PASS ${width}px opt-in UI styles, print isolation, and keyboard focus`);
    }
  } finally {
    await browser.close();
  }
}

test().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
