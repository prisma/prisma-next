import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { format } from '../../src/exports/format';

const fixturesDir = join(__dirname, 'fixtures');

const cases = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const authoredCaseCount = 7;

describe('format side-by-side fixture pairs', () => {
  it('discovers at least the authored set of fixture cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(authoredCaseCount);
  });

  for (const name of cases) {
    describe(name, () => {
      const dir = join(fixturesDir, name);
      const input = readFileSync(join(dir, 'input.prisma'), 'utf8');
      const expected = readFileSync(join(dir, 'expected.prisma'), 'utf8');

      it('formats the messy input into the committed expected golden', () => {
        expect(format(input)).toEqual(expected);
      });

      it('leaves the expected golden unchanged under format (idempotent)', () => {
        expect(format(expected)).toEqual(expected);
      });

      it('actually reformats the input', () => {
        expect(format(input)).not.toEqual(input);
      });
    });
  }
});
