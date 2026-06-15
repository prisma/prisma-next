import { constructEntries, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { composeSqlEntityKinds, tableEntityKind, valueSetEntityKind } from '../src/entity-kinds';
import { StorageTable } from '../src/ir/storage-table';
import { StorageValueSet } from '../src/ir/storage-value-set';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

const valueSetInput = { kind: 'valueSet' as const, values: ['a', 'b'] as const };

describe('tableEntityKind', () => {
  it('construct produces StorageTable instances', () => {
    const result = tableEntityKind.construct(emptyTableInput);
    expect(result).toBeInstanceOf(StorageTable);
  });
});

describe('valueSetEntityKind', () => {
  it('construct produces StorageValueSet instances', () => {
    const result = valueSetEntityKind.construct(valueSetInput);
    expect(result).toBeInstanceOf(StorageValueSet);
  });
});

describe('composeSqlEntityKinds', () => {
  it('includes table and valueSet by default', () => {
    const kinds = composeSqlEntityKinds();
    expect(kinds.has('table')).toBe(true);
    expect(kinds.has('valueSet')).toBe(true);
  });

  it('merges pack descriptors', () => {
    const synth = {
      kind: 'synthetic',
      schema: tableEntityKind.schema,
      construct: (v: unknown) => v,
    };
    const kinds = composeSqlEntityKinds([synth]);
    expect(kinds.has('synthetic')).toBe(true);
  });

  it('throws when a pack kind collides with a core kind', () => {
    const collide = { kind: 'table', schema: tableEntityKind.schema, construct: (v: unknown) => v };
    expect(() => composeSqlEntityKinds([collide])).toThrow(/collides with a core kind/);
    const collide2 = {
      kind: 'valueSet',
      schema: tableEntityKind.schema,
      construct: (v: unknown) => v,
    };
    expect(() => composeSqlEntityKinds([collide2])).toThrow(/collides with a core kind/);
  });
});

describe('constructEntries with SQL kinds (carry)', () => {
  it('constructs table entries', () => {
    const kinds = composeSqlEntityKinds();
    const result = constructEntries({ table: { users: emptyTableInput } }, kinds, 'carry');
    expect(result['table']?.['users']).toBeInstanceOf(StorageTable);
  });

  it('constructs valueSet entries', () => {
    const kinds = composeSqlEntityKinds();
    const result = constructEntries(
      { table: {}, valueSet: { Role: valueSetInput } },
      kinds,
      'carry',
    );
    expect(result['valueSet']?.['Role']).toBeInstanceOf(StorageValueSet);
  });

  it('carries unknown kinds frozen as-is', () => {
    const kinds = composeSqlEntityKinds();
    const bogusMap = Object.freeze({ foo: { x: 1 } });
    const result = constructEntries(
      { table: {}, bogus: bogusMap } as Record<string, Record<string, unknown>>,
      kinds,
      'carry',
    );
    expect(result['bogus']).toBe(bogusMap);
    expect(Object.isFrozen(result['bogus'])).toBe(true);
  });

  it('handles UNBOUND_NAMESPACE_ID as an entry key without issue', () => {
    const kinds = composeSqlEntityKinds();
    const result = constructEntries(
      { [UNBOUND_NAMESPACE_ID]: {} as Record<string, unknown>, table: {} },
      kinds,
      'carry',
    );
    expect(result[UNBOUND_NAMESPACE_ID]).toBeDefined();
  });
});
