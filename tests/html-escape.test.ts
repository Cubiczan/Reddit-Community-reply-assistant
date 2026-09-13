import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml, safeHttpUrl } from '../src/lib/html-escape.ts';

describe('escapeHtml', () => {
  it('neutralizes markup and quotes', () => {
    assert.equal(
      escapeHtml(`<img src=x onerror="alert('xss')">`),
      '&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;',
    );
  });

  it('stringifies nullish values', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(42), '42');
  });
});

describe('safeHttpUrl', () => {
  it('keeps http(s) URLs', () => {
    assert.equal(safeHttpUrl('https://reddit.com/r/foo'), 'https://reddit.com/r/foo');
    assert.equal(safeHttpUrl('http://example.com/a'), 'http://example.com/a');
  });

  it('rejects javascript and other schemes', () => {
    assert.equal(safeHttpUrl("javascript:alert(1)"), '#');
    assert.equal(safeHttpUrl('data:text/html,<script>alert(1)</script>'), '#');
    assert.equal(safeHttpUrl('not a url'), '#');
    assert.equal(safeHttpUrl(''), '#');
  });
});

function walkFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === '.next') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkFiles(full, acc);
    else if (/\.(ts|tsx|js|jsx|html)$/.test(name)) acc.push(full);
  }
  return acc;
}

describe('no document.write / dangerouslySetInnerHTML in app + public HTML', () => {
  const roots = ['src', 'public', 'examples'];
  const files = roots.flatMap((root) => walkFiles(join(process.cwd(), root)));

  it('does not use document.write/writeln with dynamic content', () => {
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (/document\.write(ln)?\s*\(/.test(text)) hits.push(file);
    }
    assert.deepEqual(hits, []);
  });

  it('does not use dangerouslySetInnerHTML', () => {
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (/dangerouslySetInnerHTML/.test(text)) hits.push(file);
    }
    assert.deepEqual(hits, []);
  });
});
