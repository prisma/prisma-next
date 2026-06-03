import { describe, expect, it } from 'vitest';
import { PostgresTableSource, pgTableRef } from '../../src/exports/contract-free';

describe('postgres contract-free dml', () => {
  it('pgTableRef returns a frozen PostgresTableSource', () => {
    const source = pgTableRef({ name: 'marker', schema: 'prisma_contract', alias: 'm' });
    expect(source).toBeInstanceOf(PostgresTableSource);
    expect(source.kind).toBe('table-source');
    expect(source.name).toBe('marker');
    expect(source.schema).toBe('prisma_contract');
    expect(source.alias).toBe('m');
    expect(Object.isFrozen(source)).toBe(true);
  });

  it('pgTableRef omits schema when not provided', () => {
    const source = pgTableRef({ name: 'marker' });
    expect(source.schema).toBeUndefined();
  });
});
