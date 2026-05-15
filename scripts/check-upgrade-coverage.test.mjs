import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execPath } from 'node:process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isGeneratedExamplePath, parseTransitionFromPath } from './check-upgrade-coverage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(HERE, 'check-upgrade-coverage.mjs');

let repo;

function git(...args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writeRepoFile(relPath, content) {
  const full = join(repo, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function writePackageJson(version) {
  writeRepoFile('package.json', JSON.stringify({ name: 'fixture', version }, null, 2));
}

function commitAll(message) {
  git('add', '-A');
  git('commit', '-m', message);
}

function runScript(args) {
  return spawnSync(execPath, [SCRIPT_PATH, ...args], { cwd: repo, encoding: 'utf8' });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pn-upgrade-coverage-'));
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('parseTransitionFromPath', () => {
  it('extracts the transition segment for the user skill', () => {
    assert.equal(
      parseTransitionFromPath('packages/0-shared/upgrade-skill/upgrades/0.6-to-0.7/foo.ts'),
      '0.6-to-0.7',
    );
  });
  it('extracts the transition segment for the extension skill', () => {
    assert.equal(
      parseTransitionFromPath(
        'packages/0-shared/extension-upgrade-skill/upgrades/0.7-to-0.8/instructions.md',
      ),
      '0.7-to-0.8',
    );
  });
  it('returns null for paths outside an upgrades/<transition>/ subdirectory', () => {
    assert.equal(parseTransitionFromPath('packages/0-shared/upgrade-skill/SKILL.md'), null);
    assert.equal(parseTransitionFromPath('packages/0-shared/upgrade-skill/upgrades/'), null);
    assert.equal(parseTransitionFromPath('examples/foo/bar.ts'), null);
  });
});

describe('isGeneratedExamplePath', () => {
  it('flags every basename in the generated set', () => {
    assert.equal(isGeneratedExamplePath('examples/foo/src/prisma/contract.json'), true);
    assert.equal(isGeneratedExamplePath('examples/foo/src/prisma/contract.d.ts'), true);
    assert.equal(isGeneratedExamplePath('examples/foo/src/prisma/end-contract.json'), true);
    assert.equal(isGeneratedExamplePath('examples/foo/src/prisma/end-contract.d.ts'), true);
  });
  it('does not flag other paths', () => {
    assert.equal(isGeneratedExamplePath('examples/foo/src/main.ts'), false);
    assert.equal(isGeneratedExamplePath('examples/foo/contract.txt'), false);
    assert.equal(isGeneratedExamplePath('packages/3-extensions/foo/contract.json'), false);
  });
});

describe('check-upgrade-coverage — coverage rule', () => {
  it('skips the coverage check on a patch bump (same in-flight minor)', () => {
    writePackageJson('0.7.0');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 1;\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.7.1');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 2;\n');
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(
      result.status,
      0,
      `expected exit 0; stderr=${result.stderr}; stdout=${result.stdout}`,
    );
  });

  it('fails when the diff touches examples/ but the user-skill directory is absent', () => {
    writePackageJson('0.6.0');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 1;\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.7.0');
    writeRepoFile('examples/demo/src/main.ts', 'export const a = 2;\n');
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /coverage/);
    assert.match(result.stderr, /packages\/0-shared\/upgrade-skill\/upgrades\/0\.6-to-0\.7/);
    assert.match(result.stderr, /examples\/demo\/src\/main\.ts/);
  });

  it('fails when the diff touches packages/3-extensions/ but the extension-skill directory is absent', () => {
    writePackageJson('0.6.0');
    writeRepoFile('packages/3-extensions/cipherstash/src/main.ts', 'export const a = 1;\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.7.0');
    writeRepoFile('packages/3-extensions/cipherstash/src/main.ts', 'export const a = 2;\n');
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /packages\/0-shared\/extension-upgrade-skill\/upgrades\/0\.6-to-0\.7/,
    );
  });

  it('requires both directories when both substrates change; passes once both are present', () => {
    writePackageJson('0.6.0');
    writeRepoFile('examples/demo/src/main.ts', 'a\n');
    writeRepoFile('packages/3-extensions/cipherstash/src/main.ts', 'a\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.7.0');
    writeRepoFile('examples/demo/src/main.ts', 'b\n');
    writeRepoFile('packages/3-extensions/cipherstash/src/main.ts', 'b\n');
    commitAll('head-broken');

    // Neither directory present → both missing.
    const missingBoth = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(missingBoth.status, 0);
    assert.match(missingBoth.stderr, /packages\/0-shared\/upgrade-skill\/upgrades\/0\.6-to-0\.7/);
    assert.match(
      missingBoth.stderr,
      /packages\/0-shared\/extension-upgrade-skill\/upgrades\/0\.6-to-0\.7/,
    );

    // Add only the user-skill directory; extension-skill still missing.
    writeRepoFile(
      'packages/0-shared/upgrade-skill/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n',
    );
    commitAll('add user-skill dir');
    const missingExt = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(missingExt.status, 0);
    assert.match(
      missingExt.stderr,
      /packages\/0-shared\/extension-upgrade-skill\/upgrades\/0\.6-to-0\.7/,
    );
    assert.doesNotMatch(
      missingExt.stderr,
      /packages\/0-shared\/upgrade-skill\/upgrades\/0\.6-to-0\.7/,
    );

    // Add the extension-skill directory; both present → pass.
    writeRepoFile(
      'packages/0-shared/extension-upgrade-skill/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n',
    );
    commitAll('add ext-skill dir');
    const both = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(both.status, 0, `expected exit 0; stderr=${both.stderr}`);
  });

  it('excludes generated example paths (contract.json etc.) from the substrate diff', () => {
    writePackageJson('0.6.0');
    writeRepoFile('examples/demo/src/prisma/contract.json', '{"v":1}\n');
    writeRepoFile('examples/demo/src/prisma/contract.d.ts', 'export type C = 1;\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.7.0');
    writeRepoFile('examples/demo/src/prisma/contract.json', '{"v":2}\n');
    writeRepoFile('examples/demo/src/prisma/contract.d.ts', 'export type C = 2;\n');
    commitAll('head');
    // No upgrades dir created. With the exclusion working, the examples/
    // diff is effectively empty and the check is vacuously satisfied.
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('publish mode: compares against the most recent v[0-9]* tag', () => {
    writePackageJson('0.6.0');
    writeRepoFile('examples/demo/src/main.ts', 'a\n');
    commitAll('prev');
    git('tag', '-a', 'v0.6.0', '-m', 'v0.6.0');
    writePackageJson('0.7.0');
    writeRepoFile('examples/demo/src/main.ts', 'b\n');
    commitAll('head');
    const result = runScript(['--mode', 'publish', '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /packages\/0-shared\/upgrade-skill\/upgrades\/0\.6-to-0\.7/);
  });
});

describe('check-upgrade-coverage — new-entries rule', () => {
  it('rejects an added file under a stale transition directory', () => {
    writePackageJson('0.7.0');
    writeRepoFile(
      'packages/0-shared/upgrade-skill/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n',
    );
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.8.0');
    writeRepoFile(
      'packages/0-shared/upgrade-skill/upgrades/0.6-to-0.7/new-script.ts',
      'export const x = 1;\n',
    );
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /new-entries-in-in-flight/);
    assert.match(result.stderr, /0\.6-to-0\.7\/new-script\.ts/);
    assert.match(result.stderr, /0\.7-to-0\.8/);
  });

  it('accepts an added file under the in-flight transition directory', () => {
    writePackageJson('0.7.0');
    writeRepoFile(
      'packages/0-shared/upgrade-skill/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n',
    );
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.8.0');
    writeRepoFile(
      'packages/0-shared/upgrade-skill/upgrades/0.7-to-0.8/instructions.md',
      '---\nfrom: "0.7"\nto: "0.8"\nchanges: []\n---\n',
    );
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('accepts adds to the in-flight directory even when prev and head share a minor (skill-bootstrap case)', () => {
    // Mirrors the real-world tml-2519 case: a PR whose package.json
    // hasn't bumped (prev=head=0.7.0) adds the placeholder directory
    // for the 0.6→0.7 transition. The inflight transition is
    // 0.6-to-0.7 (purely from head.minor), so the add is in the
    // right place.
    writePackageJson('0.7.0');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.7.0');
    writeRepoFile(
      'packages/0-shared/upgrade-skill/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n',
    );
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });

  it('accepts a modification to an existing file in a stale transition directory', () => {
    writePackageJson('0.7.0');
    writeRepoFile(
      'packages/0-shared/upgrade-skill/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n# v1\n',
    );
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');
    writePackageJson('0.8.0');
    // Same path — modification, not add.
    writeRepoFile(
      'packages/0-shared/upgrade-skill/upgrades/0.6-to-0.7/instructions.md',
      '---\nfrom: "0.6"\nto: "0.7"\nchanges: []\n---\n# v2 — bug fix\n',
    );
    commitAll('head');
    const result = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  });
});

describe('check-upgrade-coverage — in-flight minor source-of-truth', () => {
  it('reads the in-flight minor from package.json on the --head ref (not from npm or from main)', () => {
    writePackageJson('0.6.0');
    writeRepoFile('examples/demo/src/main.ts', 'a\n');
    commitAll('prev');
    const prev = git('rev-parse', 'HEAD');

    // Head A: version 0.7.0 → expected dir is upgrades/0.6-to-0.7/.
    writePackageJson('0.7.0');
    writeRepoFile('examples/demo/src/main.ts', 'b\n');
    commitAll('head-0.7.0');
    const a = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(a.status, 0);
    assert.match(a.stderr, /upgrades\/0\.6-to-0\.7/);
    assert.doesNotMatch(a.stderr, /upgrades\/0\.5-to-0\.6/);

    // Head B: version 0.8.0 on a new commit → expected dir is
    // upgrades/0.6-to-0.8/ because prev is still at 0.6.0.
    writePackageJson('0.8.0');
    writeRepoFile('examples/demo/src/main.ts', 'c\n');
    commitAll('head-0.8.0');
    const b = runScript(['--prev', prev, '--head', 'HEAD']);
    assert.notEqual(b.status, 0);
    assert.match(b.stderr, /upgrades\/0\.6-to-0\.8/);
  });
});
