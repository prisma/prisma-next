import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  createNamespaceEntrySchema,
  createSqlStorageSchema,
  StorageValueSetSchema,
} from '../src/validators';

// Synthetic pack-contributed schema used to test registry dispatch without
// depending on a target-specific schema (PostgresEnumTypeSchema now lives in
// the postgres target pack).
const SyntheticPackEntrySchema = type({
  kind: "'synthetic-kind'",
  'name?': 'string',
  values: type.string.array().readonly(),
});

// ---------------------------------------------------------------------------
// Minimal valid fixtures
// ---------------------------------------------------------------------------

const minimalTable = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
};

function makeStorage(entries: Record<string, unknown>) {
  return {
    storageHash: 'sha256:test',
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// createNamespaceEntrySchema — registry dispatch
// ---------------------------------------------------------------------------

describe('createNamespaceEntrySchema — registry-driven validation', () => {
  it('accepts a namespace with only built-in table entries when no extra registry provided', () => {
    const schema = createNamespaceEntrySchema(new Map());
    const result = schema({
      id: UNBOUND_NAMESPACE_ID,
      entries: { table: { users: minimalTable } },
    });
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('accepts a namespace with built-in valueSet entries', () => {
    const schema = createNamespaceEntrySchema(new Map());
    const result = schema({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: { users: minimalTable },
        valueSet: { Role: { kind: 'valueSet', values: ['user', 'admin'] } },
      },
    });
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('rejects a namespace with an unregistered entries key naming the kind', () => {
    const schema = createNamespaceEntrySchema(new Map());
    const result = schema({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: { users: minimalTable },
        bogus: { Foo: { kind: 'bogus', name: 'Foo' } },
      },
    });
    expect(result).toBeInstanceOf(type.errors);
    expect(String(result)).toMatch(/bogus/);
  });

  it('accepts a namespace with a pack-registered entries key', () => {
    const registry = new Map<string, ReturnType<typeof type>>([
      ['synth', SyntheticPackEntrySchema],
    ]);
    const schema = createNamespaceEntrySchema(registry);
    const result = schema({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {},
        synth: { Foo: { kind: 'synthetic-kind', values: ['a', 'b'], name: 'Foo' } },
      },
    });
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('rejects a pack-registered entry with a non-conforming value', () => {
    const registry = new Map<string, ReturnType<typeof type>>([
      ['synth', SyntheticPackEntrySchema],
    ]);
    const schema = createNamespaceEntrySchema(registry);
    const result = schema({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {},
        synth: { Foo: { kind: 'synthetic-kind' } },
      },
    });
    expect(result).toBeInstanceOf(type.errors);
  });

  it('rejects an unknown entries key even when a pack registry is provided', () => {
    const registry = new Map<string, ReturnType<typeof type>>([
      ['synth', SyntheticPackEntrySchema],
    ]);
    const schema = createNamespaceEntrySchema(registry);
    const result = schema({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {},
        synth: {},
        unknown: { X: { kind: 'unknown' } },
      },
    });
    expect(result).toBeInstanceOf(type.errors);
    expect(String(result)).toMatch(/unknown/);
  });
});

// ---------------------------------------------------------------------------
// createSqlStorageSchema — storage-level validation with registry
// ---------------------------------------------------------------------------

describe('createSqlStorageSchema — registry-driven storage validation', () => {
  it('accepts storage with built-in table + valueSet entries', () => {
    const schema = createSqlStorageSchema(new Map());
    const result = schema(
      makeStorage({
        table: { users: minimalTable },
        valueSet: { Role: { kind: 'valueSet', values: ['user', 'admin'] } },
      }),
    );
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it('rejects storage with an unregistered entries key, error names the kind', () => {
    const schema = createSqlStorageSchema(new Map());
    const result = schema(
      makeStorage({
        table: { users: minimalTable },
        bogus: { Foo: { kind: 'bogus' } },
      }),
    );
    expect(result).toBeInstanceOf(type.errors);
    expect(String(result)).toMatch(/bogus/);
  });

  it('accepts storage with a pack-registered entries key', () => {
    const registry = new Map<string, ReturnType<typeof type>>([
      ['synth', SyntheticPackEntrySchema],
    ]);
    const schema = createSqlStorageSchema(registry);
    const result = schema(
      makeStorage({
        table: {},
        synth: { Foo: { kind: 'synthetic-kind', values: ['a', 'b'], name: 'Foo' } },
      }),
    );
    expect(result).not.toBeInstanceOf(type.errors);
  });
});

// ---------------------------------------------------------------------------
// StorageValueSetSchema — kind literal updated to 'valueSet' (post-rebase)
// ---------------------------------------------------------------------------

describe('StorageValueSetSchema', () => {
  it("accepts a value-set with kind 'valueSet'", () => {
    const result = StorageValueSetSchema({ kind: 'valueSet', values: ['a', 'b'] });
    expect(result).not.toBeInstanceOf(type.errors);
  });

  it("rejects a value-set with the old kind 'value-set'", () => {
    const result = StorageValueSetSchema({ kind: 'value-set', values: ['a', 'b'] });
    expect(result).toBeInstanceOf(type.errors);
  });
});
