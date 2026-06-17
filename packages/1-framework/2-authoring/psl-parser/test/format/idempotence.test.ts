import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { format } from '../../src/exports/format';

const examplesDir = join(__dirname, '..', '..', '..', '..', '..', '..', 'examples');

const noOpOracles = [
  join(examplesDir, 'prisma-next-cloudflare-worker', 'src', 'prisma', 'contract.prisma'),
  join(examplesDir, 'mongo-blog-leaderboard', 'src', 'contract.prisma'),
];

const lines = (...parts: string[]): string => parts.join('\n');

describe('format dangling-comment idempotence', () => {
  it('is a no-op on an already-positioned dangling comment before the brace', () => {
    const source = lines('model User {', '  id Int @id', '  // trailing note', '}', '');
    expect(format(source)).toEqual(source);
  });

  it('is a no-op on an already-positioned dangling comment at end of document', () => {
    const source = lines('model User {', '  id Int @id', '}', '// end of file', '');
    expect(format(source)).toEqual(source);
  });

  it('reaches a fixed point after the first pass for a misplaced dangling comment', () => {
    const once = format('model User {\nid Int @id\n\n\n// trailing note\n}');
    expect(format(once)).toEqual(once);
  });
});

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
