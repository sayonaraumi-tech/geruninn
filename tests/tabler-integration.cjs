'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const css = fs.readFileSync(path.join(root,'styles','tabler-integration.css'),'utf8');
test('theme integration is linked once in the real entry point',()=>{
  assert.equal((html.match(/styles\/tabler-integration\.css/g)||[]).length,1);
  assert.match(html,/<link\s+rel="stylesheet"\s+href="\.\/styles\/tabler-integration\.css">/);
});
test('all nine real business pages remain wired to navigation',()=>{
  for(const page of ['dashboard','calendar','estimates','chohyo','savedDocs','sales','expenses','bank','settings'])
    assert.match(html,new RegExp('data-page="'+page+'"'));
});
test('visual integration remains screen-only, never print or PDF',()=>{
  assert.match(css,/@media screen and \(min-width: 901px\)/);
  assert.doesNotMatch(css,/@media print|\.pdf-page|\.invoice-page|\.receipt-page|#printArea/i);
  assert.doesNotMatch(css,/display\s*:\s*none\s*!important/);
});
test('business and cloud entry points have not been replaced with demo scripts',()=>{
  assert.match(html,/id="bizCloudAccountButton"/);
  assert.match(html,/id="bizNav"/);
  assert.doesNotMatch(html,/Tabler九页_v13|localStorage\.clear\(/);
});
