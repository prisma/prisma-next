import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execPath } from 'node:process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { findForbiddenHits, isScannableFile } from './lint-framework-vocabulary.mjs';

const SCRIPT_PATH = join(
  fileURLToPath(new URL('.', import.meta.url)),
  'lint-framework-vocabulary.mjs',
);

const CONFIG = {
  scopes: [
    {
      path: 'framework',
      forbidden: ['nativeType', 'postgres'],
      caseInsensitive: true,
    },
  ],
};

const FILE_WITHOUT_TERMS = 'export const x = 1;\n';
// One forbidden-term occurrence (nativeType), on line 2.
const FILE_WITH_ONE_HIT = 'export const x = 1;\nexport const nativeType = "int4";\n';
// Two forbidden-term occurrences on the same line (nativeType + postgres).
const FILE_WITH_TWO_HITS_SAME_LINE =
  'export const x = 1;\nexport const postgresNativeType = "int4";\n';

let repo;

function git(...args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writeRepoFile(relPath, content) {
  const full = join(repo, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function writeConfig(config) {
  writeRepoFile('scripts/lint-framework-vocabulary.config.json', JSON.stringify(config, null, 2));
}

function commitAll(message) {
  git('add', '-A');
  git('commit', '-m', message);
}

function setOriginMain(sha) {
  // Materialize refs/remotes/origin/main without needing a real remote.
  git('update-ref', 'refs/remotes/origin/main', sha);
}

function runScript() {
  return spawnSync(execPath, [SCRIPT_PATH], { cwd: repo, encoding: 'utf-8' });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pn-lint-framework-vocab-'));
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  writeConfig(CONFIG);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('isScannableFile', () => {
  it('accepts .ts and .tsx source files', () => {
    assert.equal(isScannableFile('framework/src/foo.ts'), true);
    assert.equal(isScannableFile('framework/src/foo.tsx'), true);
  });

  it('rejects non ts/tsx files', () => {
    assert.equal(isScannableFile('framework/src/foo.js'), false);
    assert.equal(isScannableFile('framework/README.md'), false);
  });

  it('rejects test files and dirs', () => {
    assert.equal(isScannableFile('framework/src/foo.test.ts'), false);
    assert.equal(isScannableFile('framework/src/foo.test-d.ts'), false);
    assert.equal(isScannableFile('framework/test/foo.ts'), false);
    assert.equal(isScannableFile('framework/src/test/foo.ts'), false);
  });

  it('rejects dist output', () => {
    assert.equal(isScannableFile('framework/dist/foo.ts'), false);
  });
});

describe('findForbiddenHits', () => {
  it('returns no hits when no forbidden term is present', () => {
    const scope = { forbidden: ['nativeType'], caseInsensitive: true };
    assert.deepEqual(findForbiddenHits(FILE_WITHOUT_TERMS, scope), []);
  });

  it('counts one hit per matching line', () => {
    const scope = { forbidden: ['nativeType'], caseInsensitive: true };
    const hits = findForbiddenHits(FILE_WITH_ONE_HIT, scope);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 2);
    assert.equal(hits[0].term, 'nativeType');
  });

  it('counts one hit per term per line when multiple terms match the same line', () => {
    const scope = { forbidden: ['nativeType', 'postgres'], caseInsensitive: true };
    const hits = findForbiddenHits(FILE_WITH_TWO_HITS_SAME_LINE, scope);
    assert.equal(hits.length, 2);
    assert.deepEqual(hits.map((h) => h.term).sort(), ['nativeType', 'postgres']);
  });

  it('matches case-insensitively when configured', () => {
    const scope = { forbidden: ['postgres'], caseInsensitive: true };
    const hits = findForbiddenHits('const POSTGRES_URL = "";\n', scope);
    assert.equal(hits.length, 1);
  });

  it('is case-sensitive when not configured', () => {
    const scope = { forbidden: ['postgres'], caseInsensitive: false };
    const hits = findForbiddenHits('const POSTGRES_URL = "";\n', scope);
    assert.equal(hits.length, 0);
  });
});

describe('lint-framework-vocabulary — skip on main', () => {
  it('exits 0 and prints a skip message when HEAD is at merge-base', () => {
    writeRepoFile('framework/src/app.ts', FILE_WITHOUT_TERMS);
    commitAll('initial');
    setOriginMain(git('rev-parse', 'HEAD'));
    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /Skipping/i);
  });
});

describe('lint-framework-vocabulary — zero delta', () => {
  it('exits 0 and reports delta=0 when the hit count is unchanged', () => {
    writeRepoFile('framework/src/app.ts', FILE_WITH_ONE_HIT);
    commitAll('base: one hit');
    setOriginMain(git('rev-parse', 'HEAD'));

    writeRepoFile('framework/src/other.ts', FILE_WITHOUT_TERMS);
    commitAll('feature: add unrelated file');

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /delta=0/);
  });
});

describe('lint-framework-vocabulary — negative delta', () => {
  it('exits 0 and reports a negative delta when an occurrence is removed', () => {
    writeRepoFile('framework/src/app.ts', FILE_WITH_ONE_HIT);
    commitAll('base: one hit');
    setOriginMain(git('rev-parse', 'HEAD'));

    writeRepoFile('framework/src/app.ts', FILE_WITHOUT_TERMS);
    commitAll('feature: remove occurrence');

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /delta=-1/);
  });
});

describe('lint-framework-vocabulary — positive delta', () => {
  it('exits 1 and prints added site(s) when a new occurrence is introduced', () => {
    writeRepoFile('framework/src/app.ts', FILE_WITHOUT_TERMS);
    commitAll('base: no occurrences');
    setOriginMain(git('rev-parse', 'HEAD'));

    writeRepoFile('framework/src/app.ts', FILE_WITH_ONE_HIT);
    commitAll('feature: add occurrence');

    const result = runScript();
    assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
    assert.match(result.stdout, /delta=\+1/);
    assert.match(result.stderr, /new forbidden vocabulary/i);
  });

  it('lists each new site with file:line and the trimmed source line', () => {
    writeRepoFile('framework/src/app.ts', FILE_WITHOUT_TERMS);
    commitAll('base: no occurrences');
    setOriginMain(git('rev-parse', 'HEAD'));

    writeRepoFile('framework/src/app.ts', FILE_WITH_ONE_HIT);
    commitAll('feature: add occurrence');

    const result = runScript();
    assert.equal(result.status, 1);
    // The occurrence is on line 2 of FILE_WITH_ONE_HIT.
    assert.match(result.stderr, /framework\/src\/app\.ts:2: export const nativeType/);
  });

  it('does not flag a scope path outside the ratcheted directory', () => {
    writeRepoFile('other/src/app.ts', FILE_WITHOUT_TERMS);
    commitAll('base: no occurrences');
    setOriginMain(git('rev-parse', 'HEAD'));

    writeRepoFile('other/src/app.ts', FILE_WITH_ONE_HIT);
    commitAll('feature: add occurrence outside scope');

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /delta=0/);
  });
});

describe('lint-framework-vocabulary — exclusions', () => {
  it('ignores occurrences in test files and dist output', () => {
    writeRepoFile('framework/src/app.ts', FILE_WITHOUT_TERMS);
    commitAll('base: no occurrences');
    setOriginMain(git('rev-parse', 'HEAD'));

    writeRepoFile('framework/src/app.test.ts', FILE_WITH_ONE_HIT);
    writeRepoFile('framework/src/app.test-d.ts', FILE_WITH_ONE_HIT);
    writeRepoFile('framework/test/app.ts', FILE_WITH_ONE_HIT);
    writeRepoFile('framework/dist/app.ts', FILE_WITH_ONE_HIT);
    commitAll('feature: add excluded-only occurrences');

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /delta=0/);
  });
});

describe('lint-framework-vocabulary — worktree cleanup', () => {
  it('leaves no stray worktrees after a successful run', () => {
    writeRepoFile('framework/src/app.ts', FILE_WITHOUT_TERMS);
    commitAll('base');
    setOriginMain(git('rev-parse', 'HEAD'));
    writeRepoFile('framework/src/other.ts', FILE_WITHOUT_TERMS);
    commitAll('feature');

    runScript();

    const worktreeList = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repo,
      encoding: 'utf-8',
    });
    const worktreeCount = worktreeList.split('\n').filter((l) => l.startsWith('worktree ')).length;
    assert.equal(worktreeCount, 1, `expected 1 worktree; got:\n${worktreeList}`);
  });
});
