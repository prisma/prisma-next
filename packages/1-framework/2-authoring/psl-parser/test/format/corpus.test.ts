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

const repoRelative = (file: string): string => relative(repoRoot, file).split(sep).join('/');

// Corpus files whose source is already in canonical form: format(source) === source.
// Kept explicit and sorted so the no-op set is reviewable. Every other corpus file
// must reformat (format(source) !== source); a file flipping direction either way
// fails the classification guard below and forces a conscious reclassification.
const knownNoOpFiles = [
  'examples/mongo-blog-leaderboard/src/contract.prisma',
  'examples/prisma-next-cloudflare-worker/src/prisma/contract.prisma',
] as const;

const isKnownNoOp = (file: string): boolean =>
  (knownNoOpFiles as readonly string[]).includes(repoRelative(file));

const goldenNameFor = (file: string): string =>
  relative(repoRoot, file)
    .split(sep)
    .join('__')
    .replace(/\.prisma$|\.psl$/, '.psl');

describe('formatter golden corpus', () => {
  it('discovers at least the known set of corpus files', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(knownCorpusSize);
  });

  it('reformats every corpus file except exactly the known no-op set', () => {
    const noOp = corpus
      .filter((file) => format(readFileSync(file, 'utf8')) === readFileSync(file, 'utf8'))
      .map(repoRelative)
      .sort();
    expect(noOp).toEqual([...knownNoOpFiles].sort());
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

      if (isKnownNoOp(file)) {
        expect(once, `${name} is a known no-op but format() changed it`).toEqual(source);
      } else {
        expect(once, `${name} should reformat but format() left it unchanged`).not.toEqual(source);
      }

      await expect(once).toMatchFileSnapshot(golden);
    });
  }
});
