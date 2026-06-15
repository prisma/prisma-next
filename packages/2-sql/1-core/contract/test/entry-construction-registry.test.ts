import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  createSqlEntryConstructionRegistry,
  dispatchEntriesToRegistry,
} from '../src/entry-construction-registry';
import { StorageTable } from '../src/ir/storage-table';
import { StorageValueSet } from '../src/ir/storage-value-set';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

const valueSetInput = { kind: 'valueSet' as const, values: ['a', 'b'] as const };

describe('createSqlEntryConstructionRegistry — core kinds', () => {
  it('registers table and valueSet by default', () => {
    const reg = createSqlEntryConstructionRegistry();
    expect(reg.has('table')).toBe(true);
    expect(reg.has('valueSet')).toBe(true);
  });

  it('tableFactory produces StorageTable instances', () => {
    const reg = createSqlEntryConstructionRegistry();
    const factory = reg.get('table');
    expect(factory).toBeDefined();
    const result = factory!(emptyTableInput);
    expect(result).toBeInstanceOf(StorageTable);
  });

  it('valueSetFactory produces StorageValueSet instances', () => {
    const reg = createSqlEntryConstructionRegistry();
    const factory = reg.get('valueSet');
    expect(factory).toBeDefined();
    const result = factory!(valueSetInput);
    expect(result).toBeInstanceOf(StorageValueSet);
  });

  it('pack factories are merged into the registry', () => {
    const synth = (v: unknown): unknown => ({ synthetic: true, raw: v });
    const reg = createSqlEntryConstructionRegistry(new Map([['synthetic', synth]]));
    expect(reg.has('synthetic')).toBe(true);
    expect(reg.get('synthetic')!({ x: 1 })).toEqual({ synthetic: true, raw: { x: 1 } });
  });

  it('throws when a pack factory collides with a core kind', () => {
    expect(() => createSqlEntryConstructionRegistry(new Map([['table', () => ({})]]))).toThrow(
      /table/,
    );
    expect(() => createSqlEntryConstructionRegistry(new Map([['valueSet', () => ({})]]))).toThrow(
      /valueSet/,
    );
  });
});

describe('dispatchEntriesToRegistry', () => {
  it('constructs table entries via registry', () => {
    const reg = createSqlEntryConstructionRegistry();
    const result = dispatchEntriesToRegistry({ table: { users: emptyTableInput } }, reg);
    expect(result['table']?.['users']).toBeInstanceOf(StorageTable);
  });

  it('constructs valueSet entries via registry', () => {
    const reg = createSqlEntryConstructionRegistry();
    const result = dispatchEntriesToRegistry({ table: {}, valueSet: { Role: valueSetInput } }, reg);
    expect(result['valueSet']?.['Role']).toBeInstanceOf(StorageValueSet);
  });

  it('carries unknown kinds frozen as-is', () => {
    const reg = createSqlEntryConstructionRegistry();
    const bogusMap = Object.freeze({ foo: { x: 1 } });
    const result = dispatchEntriesToRegistry(
      { table: {}, bogus: bogusMap } as Record<string, Record<string, unknown>>,
      reg,
    );
    expect(result['bogus']).toBe(bogusMap);
    expect(Object.isFrozen(result['bogus'])).toBe(true);
  });

  it('handles id = UNBOUND_NAMESPACE_ID entry without issue', () => {
    const reg = createSqlEntryConstructionRegistry();
    const result = dispatchEntriesToRegistry(
      { [UNBOUND_NAMESPACE_ID]: {} as Record<string, unknown>, table: {} },
      reg,
    );
    expect(result[UNBOUND_NAMESPACE_ID]).toBeDefined();
  });
});
