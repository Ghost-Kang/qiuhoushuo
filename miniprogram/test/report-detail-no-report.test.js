const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join('miniprogram', 'pages', 'report-detail');

test('完赛但无战报(404 空窗)不白屏:有"生成中"友好态 + 刷新', () => {
  const wxml = readFileSync(join(root, 'index.wxml'), 'utf8');
  assert.match(wxml, /noReport/);
  assert.match(wxml, /战报生成中/);
  assert.match(wxml, /bindtap="retryReport"/);

  const js = readFileSync(join(root, 'index.js'), 'utf8');
  // 404 / 无 style 内容 → noReport=true 而非把 {error} 当 report 渲染
  assert.match(js, /res\.statusCode === 200/);
  assert.match(js, /noReport: true/);
  assert.match(js, /retryReport\(\)/);
});
