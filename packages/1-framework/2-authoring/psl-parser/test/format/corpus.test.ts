import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { format, PslFormatError } from '../../src/exports/format';

const repoRoot = join(__dirname, '..', '..', '..', '..', '..', '..');
const examplesDir = join(repoRoot, 'examples');
const fixtureFile = join(__dirname, '..', 'fixtures', 'schema.psl');

const prunedDirs = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-tsc',
  'dist-tsc-prod',
  'coverage',
  '.turbo',
  '.next',
  'build',
]);

const collectContractFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (prunedDirs.has(entry)) {
      continue;
    }
    const entryPath = join(dir, entry);
    if (statSync(entryPath).isDirectory()) {
      found.push(...collectContractFiles(entryPath));
    } else if (entry === 'contract.prisma') {
      found.push(entryPath);
    }
  }
  return found;
};

const corpus = [...collectContractFiles(examplesDir).sort(), fixtureFile];

const knownCorpusSize = 31;

const goldenNameFor = (file: string): string =>
  relative(repoRoot, file)
    .split(sep)
    .join('__')
    .replace(/\.prisma$|\.psl$/, '.psl');

describe('formatter golden corpus', () => {
  it('discovers at least the known set of corpus files', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(knownCorpusSize);
  });

  for (const file of corpus) {
    const name = relative(repoRoot, file);
    const golden = join(__dirname, '__snapshots__', 'corpus', goldenNameFor(file));

    it(`formats ${name} idempotently and matches its golden`, async () => {
      const source = readFileSync(file, 'utf8');

      let once: string;
      try {
        once = format(source);
      } catch (error) {
        if (error instanceof PslFormatError) {
          throw new Error(
            `${name} refused to format with ${error.diagnostics.length} diagnostic(s): ${error.diagnostics
              .map((diagnostic) => diagnostic.message)
              .join('; ')}`,
          );
        }
        throw error;
      }

      expect(format(once), `${name} is not idempotent under format()`).toEqual(once);

      await expect(once).toMatchFileSnapshot(golden);
    });
  }
});
