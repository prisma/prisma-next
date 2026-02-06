import { describe, expect, it } from 'vitest';
import { sql, tables } from '../src/prisma/query';

describe('when no runtime is available', () => {
  it('can still build query plans from static context', () => {
    const plan = sql.from(tables.user).select({ id: tables.user.columns.id }).limit(1).build();

    expect(plan).toMatchObject({
      ast: { kind: 'select' },
      meta: { lane: 'dsl' },
    });
  });
});
