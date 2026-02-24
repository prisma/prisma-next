import { describe, expect, it } from 'vitest';
import { queryCompiler } from '../src/kysely-compiler-shared';

describe('kysely-compiler-shared', () => {
  it('queryCompiler compiles basic select statements', () => {
    const compiled = queryCompiler.selectFrom('users').selectAll().compile();

    expect(compiled.sql.toLowerCase()).toContain('select');
    expect(compiled.sql.toLowerCase()).toContain('"users"');
  });

  it('queryCompiler exposes introspection api via dialect introspector', async () => {
    await expect(queryCompiler.introspection.getSchemas()).resolves.toEqual([]);
  });
});
