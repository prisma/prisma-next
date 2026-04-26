import { describe, expect, it } from 'vitest';
import {
  mergeGitattributes,
  requiredGitattributesLines,
} from '../../../src/commands/init/hygiene-gitattributes';
import {
  mergeGitignore,
  REQUIRED_GITIGNORE_ENTRIES,
} from '../../../src/commands/init/hygiene-gitignore';
import {
  mergePackageScripts,
  REQUIRED_SCRIPTS,
} from '../../../src/commands/init/hygiene-package-scripts';

// ---------------------------------------------------------------------------
// FR3.3 — .gitignore merge
// ---------------------------------------------------------------------------

describe('mergeGitignore (FR3.3)', () => {
  it('writes the full required entry list when the file does not exist', () => {
    const result = mergeGitignore(undefined);
    expect(result).toBe(`${REQUIRED_GITIGNORE_ENTRIES.join('\n')}\n`);
  });

  it('appends only the missing entries when some are already present', () => {
    const existing = 'node_modules/\n';
    const result = mergeGitignore(existing);
    expect(result).toBe('node_modules/\ndist/\n.env\n');
  });

  it('returns null when every required entry is already present (idempotent)', () => {
    const existing = 'node_modules/\ndist/\n.env\n';
    expect(mergeGitignore(existing)).toBeNull();
  });

  it('does not duplicate entries on a re-run (FR9.3)', () => {
    const first = mergeGitignore('node_modules/\n');
    expect(first).not.toBeNull();
    const second = mergeGitignore(first ?? '');
    expect(second).toBeNull();
  });

  it('preserves user-authored comments and blank lines', () => {
    const existing = '# top-level comment\n\nnode_modules/\n# trailing\n';
    const result = mergeGitignore(existing);
    expect(result).toContain('# top-level comment');
    expect(result).toContain('# trailing');
    expect(result).toContain('dist/');
    expect(result).toContain('.env');
  });

  it('treats node_modules without trailing slash as a different entry', () => {
    // The AC pins the trailing-slash form; we don't conflate the two
    // because git treats them differently (slash restricts to dirs).
    const result = mergeGitignore('node_modules\n');
    expect(result).toContain('node_modules\n');
    expect(result).toContain('node_modules/');
  });

  it('appends a leading newline when the existing file lacks one', () => {
    const result = mergeGitignore('node_modules/');
    expect(result).toBe('node_modules/\ndist/\n.env\n');
  });
});

// ---------------------------------------------------------------------------
// FR3.4 — .gitattributes merge
// ---------------------------------------------------------------------------

describe('requiredGitattributesLines (FR3.4)', () => {
  it('emits linguist-generated lines for the schema directory', () => {
    const lines = requiredGitattributesLines('prisma', 'postgres');
    expect(lines).toContain('prisma/contract.json linguist-generated');
    expect(lines).toContain('prisma/contract.d.ts linguist-generated');
  });

  it('includes forward-looking artefacts (Decision 5)', () => {
    const lines = requiredGitattributesLines('prisma', 'postgres');
    expect(lines).toContain('prisma/end-contract.json linguist-generated');
    expect(lines).toContain('prisma/start-contract.d.ts linguist-generated');
    expect(lines).toContain('prisma/ops.json linguist-generated');
    expect(lines).toContain('prisma/migration.json linguist-generated');
  });

  it('respects a non-default schema directory', () => {
    const lines = requiredGitattributesLines('db', 'mongo');
    expect(lines).toContain('db/contract.json linguist-generated');
    // No prisma/ leakage when the schema lives elsewhere.
    expect(lines.every((line) => !line.startsWith('prisma/'))).toBe(true);
  });

  it('strips a trailing slash from the schema directory', () => {
    const lines = requiredGitattributesLines('prisma/', 'postgres');
    expect(lines).toContain('prisma/contract.json linguist-generated');
    expect(lines.every((line) => !line.startsWith('prisma//'))).toBe(true);
  });
});

describe('mergeGitattributes (FR3.4)', () => {
  const required = requiredGitattributesLines('prisma', 'postgres');

  it('writes the full required line list when the file does not exist', () => {
    const result = mergeGitattributes(undefined, required);
    expect(result).not.toBeNull();
    for (const line of required) {
      expect(result).toContain(line);
    }
  });

  it('appends only the missing lines when some are already present', () => {
    const existing = 'prisma/contract.json linguist-generated\n';
    const result = mergeGitattributes(existing, required);
    expect(result).not.toBeNull();
    expect(result).toContain('prisma/contract.json linguist-generated');
    expect(result).toContain('prisma/contract.d.ts linguist-generated');
    // Pre-existing line should appear exactly once.
    const occurrences = (result ?? '').split('prisma/contract.json linguist-generated').length - 1;
    expect(occurrences).toBe(1);
  });

  it('returns null when every required line is already present (idempotent / FR9.3)', () => {
    const existing = `${required.join('\n')}\n`;
    expect(mergeGitattributes(existing, required)).toBeNull();
  });

  it('preserves unrelated user-authored attribute lines', () => {
    const existing = '*.lock binary\n';
    const result = mergeGitattributes(existing, required);
    expect(result).toContain('*.lock binary');
    expect(result).toContain('prisma/contract.json linguist-generated');
  });
});

// ---------------------------------------------------------------------------
// FR3.5 — package.json#scripts merge with collision detection
// ---------------------------------------------------------------------------

describe('mergePackageScripts (FR3.5)', () => {
  it('adds the contract:emit script when scripts is missing entirely', () => {
    const pkg = JSON.stringify({ name: 'app' }, null, 2);
    const { content, warnings } = mergePackageScripts(pkg, REQUIRED_SCRIPTS);
    expect(content).not.toBeNull();
    expect(warnings).toEqual([]);
    const parsed = JSON.parse(content ?? '');
    expect(parsed.scripts).toEqual({ 'contract:emit': 'prisma-next contract emit' });
  });

  it('preserves existing user scripts and appends contract:emit', () => {
    const pkg = JSON.stringify({ name: 'app', scripts: { build: 'tsc', test: 'vitest' } }, null, 2);
    const { content, warnings } = mergePackageScripts(pkg, REQUIRED_SCRIPTS);
    expect(content).not.toBeNull();
    expect(warnings).toEqual([]);
    const parsed = JSON.parse(content ?? '');
    expect(parsed.scripts).toEqual({
      build: 'tsc',
      test: 'vitest',
      'contract:emit': 'prisma-next contract emit',
    });
  });

  it('returns null content when contract:emit is already correct (idempotent / FR9.3)', () => {
    const pkg = JSON.stringify(
      { name: 'app', scripts: { 'contract:emit': 'prisma-next contract emit' } },
      null,
      2,
    );
    const { content, warnings } = mergePackageScripts(pkg, REQUIRED_SCRIPTS);
    expect(content).toBeNull();
    expect(warnings).toEqual([]);
  });

  it('warns and skips when an existing script name maps to a different command (FR3.5)', () => {
    const pkg = JSON.stringify(
      { name: 'app', scripts: { 'contract:emit': './scripts/custom-emit.sh' } },
      null,
      2,
    );
    const { content, warnings } = mergePackageScripts(pkg, REQUIRED_SCRIPTS);
    expect(content).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"contract:emit"');
    expect(warnings[0]).toContain('./scripts/custom-emit.sh');
    expect(warnings[0]).toContain('prisma-next contract emit');
  });

  it("preserves the user's key order (no reshuffle)", () => {
    const pkg = JSON.stringify({ name: 'app', scripts: { z: 'last', a: 'first' } }, null, 2);
    const { content } = mergePackageScripts(pkg, REQUIRED_SCRIPTS);
    expect(content).not.toBeNull();
    const keys = Object.keys(JSON.parse(content ?? '').scripts as Record<string, string>);
    // New entry appends; existing keep their relative order.
    expect(keys).toEqual(['z', 'a', 'contract:emit']);
  });

  it('preserves the trailing newline if the input had one', () => {
    const pkg = `${JSON.stringify({ name: 'app' }, null, 2)}\n`;
    const { content } = mergePackageScripts(pkg, REQUIRED_SCRIPTS);
    expect(content?.endsWith('\n')).toBe(true);
  });

  it('does not add a trailing newline if the input lacked one', () => {
    const pkg = JSON.stringify({ name: 'app' }, null, 2);
    const { content } = mergePackageScripts(pkg, REQUIRED_SCRIPTS);
    expect(content?.endsWith('\n')).toBe(false);
  });
});
