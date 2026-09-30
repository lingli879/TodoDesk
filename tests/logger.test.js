const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const logger = require('../src/main/logger');

test('追加写入并轮转', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-'));
  for (let i = 0; i < 50; i++) logger.write(dir, `line-${i}-` + 'x'.repeat(30000));
  assert.ok(fs.existsSync(path.join(dir, 'log.old.txt')));
  const cur = fs.readFileSync(path.join(dir, 'log.txt'), 'utf8');
  assert.ok(cur.length < 1024 * 1024 + 40000);
});
