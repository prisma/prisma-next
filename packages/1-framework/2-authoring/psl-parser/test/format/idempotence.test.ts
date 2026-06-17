import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { format } from '../../src/exports/format';

const examplesDir = join(__dirname, '..', '..', '..', '..', '..', '..', 'examples');

const noOpOracles = [
  join(examplesDir, 'prisma-next-cloudflare-worker', 'src', 'prisma', 'contract.prisma'),
  join(examplesDir, 'mongo-blog-leaderboard', 'src', 'contract.prisma'),
];

describe('format no-op oracles', () => {
  for (const path of noOpOracles) {
    it(`formats ${path} as a byte-for-byte no-op`, () => {
      const source = readFileSync(path, 'utf8');
      expect(format(source)).toEqual(source);
    });

    it(`formats ${path} idempotently`, () => {
      const source = readFileSync(path, 'utf8');
      const once = format(source);
      expect(format(once)).toEqual(once);
    });
  }
});
