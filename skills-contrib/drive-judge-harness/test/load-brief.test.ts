import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'pathe';
import { loadCase } from '../load-brief.ts';

const GOLDEN_DIR = fileURLToPath(
  new URL('../../../projects/drive-judge-harness/assets/golden/', import.meta.url),
);

describe('loadCase — real golden case', () => {
  const golden = loadCase(join(GOLDEN_DIR, 'slice-cli-list-flag'));

  it('parses the case metadata', () => {
    assert.equal(golden.meta.slug, 'slice-cli-list-flag');
    assert.equal(golden.meta.shape, 'slice');
    assert.ok(golden.meta.recommended_model.length > 0);
  });

  it('reads the brief text', () => {
    assert.ok(golden.briefText.includes('--json'));
  });
});

describe('loadCase — every shipped golden case loads', () => {
  const slugs = [
    'direct-change-diagnostic-wording',
    'slice-cli-list-flag',
    'project-retry-policy',
    'i12-halt-storage-assumption',
    'spike-first-flaky-test',
  ];
  for (const slug of slugs) {
    it(`loads ${slug}`, () => {
      const golden = loadCase(join(GOLDEN_DIR, slug));
      assert.equal(golden.meta.slug, slug);
      assert.ok(golden.briefText.trim().length > 0);
    });
  }
});

describe('loadCase — error handling', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'judge-load-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws when case.json is missing', () => {
    assert.throws(() => loadCase(dir), /case\.json/);
  });

  it('throws when a metadata field is missing', () => {
    writeFileSync(join(dir, 'case.json'), JSON.stringify({ slug: 'x' }));
    assert.throws(() => loadCase(dir), /title/);
  });

  it('throws when brief.md is missing', () => {
    writeFileSync(
      join(dir, 'case.json'),
      JSON.stringify({
        slug: 'x',
        title: 't',
        shape: 'slice',
        recommended_model: 'm',
        summary: 's',
      }),
    );
    assert.throws(() => loadCase(dir), /brief\.md/);
  });
});
