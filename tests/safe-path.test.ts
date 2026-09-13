import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveWithinBase } from '../src/lib/safe-path.ts';

const base = '/workspace/project';

describe('resolveWithinBase', () => {
  it('keeps in-tree relative paths', () => {
    assert.equal(
      resolveWithinBase('slides/a.html', base),
      path.resolve(base, 'slides/a.html'),
    );
  });

  it('keeps in-tree absolute paths', () => {
    assert.equal(
      resolveWithinBase(path.join(base, 'slides/a.html'), base),
      path.resolve(base, 'slides/a.html'),
    );
  });

  it('allows .. segments that stay inside the base', () => {
    assert.equal(
      resolveWithinBase('slides/../assets/x.png', base),
      path.resolve(base, 'assets/x.png'),
    );
  });

  it('rejects relative traversal', () => {
    assert.throws(
      () => resolveWithinBase('../../etc/passwd', base),
      /escapes allowed directory/,
    );
  });

  it('rejects absolute paths outside the base', () => {
    assert.throws(
      () => resolveWithinBase('/etc/passwd', base),
      /escapes allowed directory/,
    );
  });

  it('rejects file:// URLs outside the base', () => {
    assert.throws(
      () => resolveWithinBase('file:///etc/passwd', base),
      /escapes allowed directory/,
    );
    assert.throws(
      () => resolveWithinBase('file://localhost/etc/passwd', base),
      /escapes allowed directory/,
    );
  });

  it('accepts file:// URLs inside the base', () => {
    assert.equal(
      resolveWithinBase(`file://${base}/slide.html`, base),
      path.resolve(base, 'slide.html'),
    );
  });

  it('rejects empty paths and NUL bytes', () => {
    assert.throws(() => resolveWithinBase('', base), /Invalid path/);
    assert.throws(() => resolveWithinBase('slide.html\0.png', base), /Invalid path/);
  });
});

describe('html2pptx confines filesystem reads', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'skills/pptx/scripts/html2pptx.js'),
    'utf8',
  );

  it('resolves html and image paths through resolveWithinBase', () => {
    assert.match(source, /function resolveWithinBase/);
    assert.match(source, /resolveWithinBase\(htmlFile, baseDir\)/);
    assert.match(source, /resolveWithinBase\(slideData\.background\.path, baseDir\)/);
    assert.match(source, /resolveWithinBase\(el\.src, baseDir\)/);
  });

  it('does not join cwd with unsanitized htmlFile', () => {
    assert.doesNotMatch(source, /path\.join\(process\.cwd\(\),\s*htmlFile\)/);
  });
});
