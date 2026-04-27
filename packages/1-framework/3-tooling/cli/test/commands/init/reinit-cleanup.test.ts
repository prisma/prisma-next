import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findStaleArtefacts, removeDependency } from '../../../src/commands/init/reinit-cleanup';

describe('findStaleArtefacts (FR9.1)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'reinit-find-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the empty list when the schema dir does not exist', () => {
    expect(findStaleArtefacts(tmpDir, 'prisma')).toEqual([]);
  });

  it('returns the empty list when no artefact files are present', () => {
    mkdirSync(join(tmpDir, 'prisma'));
    writeFileSync(join(tmpDir, 'prisma', 'contract.prisma'), 'model User {}');
    expect(findStaleArtefacts(tmpDir, 'prisma')).toEqual([]);
  });

  it('returns each known artefact filename present in the schema dir', () => {
    mkdirSync(join(tmpDir, 'prisma'));
    writeFileSync(join(tmpDir, 'prisma', 'contract.json'), '{}');
    writeFileSync(join(tmpDir, 'prisma', 'contract.d.ts'), 'export {}');
    writeFileSync(join(tmpDir, 'prisma', 'end-contract.json'), '{}');
    expect(findStaleArtefacts(tmpDir, 'prisma')).toEqual([
      'prisma/contract.json',
      'prisma/contract.d.ts',
      'prisma/end-contract.json',
    ]);
  });

  it('honours a non-default schema dir', () => {
    mkdirSync(join(tmpDir, 'db', 'nested'), { recursive: true });
    writeFileSync(join(tmpDir, 'db', 'nested', 'contract.json'), '{}');
    expect(findStaleArtefacts(tmpDir, 'db/nested')).toEqual(['db/nested/contract.json']);
  });

  it('does not flag unrelated files that just happen to live in the schema dir', () => {
    mkdirSync(join(tmpDir, 'prisma'));
    writeFileSync(join(tmpDir, 'prisma', 'contract.prisma'), 'model User {}');
    writeFileSync(join(tmpDir, 'prisma', 'README.md'), '# notes');
    writeFileSync(join(tmpDir, 'prisma', 'seed.ts'), 'export {}');
    expect(findStaleArtefacts(tmpDir, 'prisma')).toEqual([]);
  });
});

describe('removeDependency (FR9.2)', () => {
  it('returns null when dependencies is missing', () => {
    expect(removeDependency('{"name":"app"}', '@prisma-next/postgres')).toBeNull();
  });

  it('returns null when dependencies is not an object', () => {
    expect(removeDependency('{"dependencies":[]}', '@prisma-next/postgres')).toBeNull();
  });

  it('returns null when the named dep is absent', () => {
    expect(
      removeDependency(
        JSON.stringify({ dependencies: { '@prisma-next/mongo': '^1.0.0' } }),
        '@prisma-next/postgres',
      ),
    ).toBeNull();
  });

  it('drops the named dep and preserves siblings', () => {
    const before = JSON.stringify(
      {
        name: 'app',
        dependencies: {
          '@prisma-next/postgres': '^1.0.0',
          dotenv: '^16.0.0',
        },
        devDependencies: { typescript: '^5.0.0' },
      },
      null,
      2,
    );
    const after = removeDependency(before, '@prisma-next/postgres');
    expect(after).not.toBeNull();
    const parsed = JSON.parse(after as string) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(parsed.dependencies).toEqual({ dotenv: '^16.0.0' });
    expect(parsed.devDependencies).toEqual({ typescript: '^5.0.0' });
  });

  it('preserves a trailing newline when present', () => {
    const before = `${JSON.stringify({ dependencies: { foo: '1.0.0' } }, null, 2)}\n`;
    const after = removeDependency(before, 'foo') as string;
    expect(after.endsWith('\n')).toBe(true);
  });

  it('omits a trailing newline when the input lacked one', () => {
    const before = JSON.stringify({ dependencies: { foo: '1.0.0' } }, null, 2);
    const after = removeDependency(before, 'foo') as string;
    expect(after.endsWith('\n')).toBe(false);
  });

  it('does not touch peerDependencies or devDependencies', () => {
    const before = JSON.stringify(
      {
        dependencies: { '@prisma-next/postgres': '^1.0.0' },
        peerDependencies: { '@prisma-next/postgres': '^1.0.0' },
      },
      null,
      2,
    );
    const after = removeDependency(before, '@prisma-next/postgres') as string;
    const parsed = JSON.parse(after) as {
      dependencies: Record<string, string>;
      peerDependencies: Record<string, string>;
    };
    expect(parsed.dependencies).toEqual({});
    expect(parsed.peerDependencies).toEqual({ '@prisma-next/postgres': '^1.0.0' });
  });
});
