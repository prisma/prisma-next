import type { ColumnDefault } from '@prisma-next/contract/types';
import type { SqlStorage, StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import type { DefaultRenderer } from '../src/core/migrations/contract-to-schema-ir';
import {
  contractToSchemaIR,
  detectDestructiveChanges,
} from '../src/core/migrations/contract-to-schema-ir';

function isTaggedBigInt(v: unknown): v is { $type: 'bigint'; value: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    '$type' in v &&
    (v as Record<string, unknown>)['$type'] === 'bigint'
  );
}

function isTaggedRaw(v: unknown): v is { $type: 'raw'; value: unknown } {
  return (
    typeof v === 'object' &&
    v !== null &&
    '$type' in v &&
    (v as Record<string, unknown>)['$type'] === 'raw'
  );
}

const testRenderer: DefaultRenderer = (def: ColumnDefault, column: StorageColumn) => {
  if (def.kind === 'function') return def.expression;
  const { value } = def;
  const isJsonColumn = column.nativeType === 'json' || column.nativeType === 'jsonb';
  if (isTaggedBigInt(value)) return value.value;
  if (isTaggedRaw(value)) return String(value.value);
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'NULL';
  const json = JSON.stringify(value);
  if (isJsonColumn) return `'${json}'::${column.nativeType}`;
  return `'${json}'`;
};

function col(overrides: Partial<StorageColumn> & { nativeType: string }): StorageColumn {
  return {
    codecId: 'pg/text@1',
    nullable: false,
    ...overrides,
  };
}

function table(
  overrides: Partial<StorageTable> & { columns: Record<string, StorageColumn> },
): StorageTable {
  return {
    uniques: [],
    indexes: [],
    foreignKeys: [],
    ...overrides,
  };
}

describe('contractToSchemaIR', () => {
  it('converts empty storage to empty schema IR', () => {
    const storage: SqlStorage = { tables: {} };
    const result = contractToSchemaIR(storage, undefined, testRenderer);

    expect(result).toEqual<SqlSchemaIR>({
      tables: {},
      extensions: [],
    });
  });

  it('converts a single table with columns', () => {
    const storage: SqlStorage = {
      tables: {
        User: table({
          columns: {
            id: col({ nativeType: 'text' }),
            email: col({ nativeType: 'text', nullable: false }),
            name: col({ nativeType: 'text', nullable: true }),
          },
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);

    expect(result.tables['User']).toBeDefined();
    expect(result.tables['User']!.name).toBe('User');

    const columns = result.tables['User']!.columns;
    expect(columns['id']).toEqual({ name: 'id', nativeType: 'text', nullable: false });
    expect(columns['email']).toEqual({ name: 'email', nativeType: 'text', nullable: false });
    expect(columns['name']).toEqual({ name: 'name', nativeType: 'text', nullable: true });
  });

  it('drops codecId, typeParams, and typeRef from columns', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            a: col({
              nativeType: 'vector',
              codecId: 'pgvector/vector@1',
              typeParams: { dimensions: 1536 },
              typeRef: 'MyVector',
            }),
          },
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    const column = result.tables['T']!.columns['a']!;

    expect(column).toEqual({ name: 'a', nativeType: 'vector', nullable: false });
    expect('codecId' in column).toBe(false);
    expect('typeParams' in column).toBe(false);
    expect('typeRef' in column).toBe(false);
  });

  it('expands parameterized native types when expandNativeType is provided', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            id: col({
              nativeType: 'character',
              codecId: 'sql/char@1',
              typeParams: { length: 36 },
            }),
            name: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
        }),
      },
    };

    const expand = (input: {
      nativeType: string;
      codecId?: string;
      typeParams?: Record<string, unknown>;
    }) => {
      if (input.typeParams && 'length' in input.typeParams) {
        return `${input.nativeType}(${input.typeParams['length']})`;
      }
      return input.nativeType;
    };

    const result = contractToSchemaIR(storage, expand, testRenderer);
    expect(result.tables['T']!.columns['id']!.nativeType).toBe('character(36)');
    expect(result.tables['T']!.columns['name']!.nativeType).toBe('text');
  });

  it('uses base nativeType when no expandNativeType is provided', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            id: col({
              nativeType: 'character',
              codecId: 'sql/char@1',
              typeParams: { length: 36 },
            }),
          },
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['T']!.columns['id']!.nativeType).toBe('character');
  });

  it('converts literal column defaults', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            status: col({
              nativeType: 'text',
              default: { kind: 'literal', value: 'active' },
            }),
          },
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['T']!.columns['status']!.default).toBe("'active'");
  });

  it('escapes single quotes in string literal defaults', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            author: col({
              nativeType: 'text',
              default: { kind: 'literal', value: "O'Reilly" },
            }),
          },
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['T']!.columns['author']!.default).toBe("'O''Reilly'");
  });

  it('escapes repeated single quotes in string literal defaults', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            textValue: col({
              nativeType: 'text',
              default: { kind: 'literal', value: "a'b''c" },
            }),
          },
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['T']!.columns['textValue']!.default).toBe("'a''b''''c'");
  });

  it('converts object literal defaults to JSON string via renderer', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            metadata: col({
              nativeType: 'jsonb',
              default: { kind: 'literal', value: { foo: 'bar' } },
            }),
          },
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['T']!.columns['metadata']!.default).toBe('\'{"foo":"bar"}\'::jsonb');
  });

  it('converts array literal defaults to JSON string via renderer', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            tags: col({
              nativeType: 'jsonb',
              default: { kind: 'literal', value: [1, 2, 3] },
            }),
          },
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['T']!.columns['tags']!.default).toBe("'[1,2,3]'::jsonb");
  });

  it('converts TaggedBigInt defaults to unquoted numeric string via renderer', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            bigId: col({
              nativeType: 'int8',
              default: { kind: 'literal', value: { $type: 'bigint' as const, value: '42' } },
            }),
          },
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['T']!.columns['bigId']!.default).toBe('42');
  });

  it('converts TaggedRaw defaults to raw expression via renderer', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            computed: col({
              nativeType: 'int4',
              default: {
                kind: 'literal',
                value: { $type: 'raw' as const, value: "nextval('my_seq')" },
              },
            }),
          },
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['T']!.columns['computed']!.default).toBe("nextval('my_seq')");
  });

  it('converts nested object defaults to JSON string via renderer', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            config: col({
              nativeType: 'jsonb',
              default: { kind: 'literal', value: { a: { b: [1, 2] } } },
            }),
          },
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['T']!.columns['config']!.default).toBe('\'{"a":{"b":[1,2]}}\'::jsonb');
  });

  it('converts function column defaults', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            createdAt: col({
              nativeType: 'timestamptz',
              default: { kind: 'function', expression: 'now()' },
            }),
          },
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['T']!.columns['createdAt']!.default).toBe('now()');
  });

  it('omits default field when column has no default', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            name: col({ nativeType: 'text' }),
          },
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['T']!.columns['name']!.default).toBeUndefined();
    expect('default' in result.tables['T']!.columns['name']!).toBe(false);
  });

  it('converts primary key', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            id: col({ nativeType: 'text' }),
          },
          primaryKey: { columns: ['id'], name: 'T_pkey' },
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['T']!.primaryKey).toEqual({ columns: ['id'], name: 'T_pkey' });
  });

  it('converts unique constraints', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            email: col({ nativeType: 'text' }),
          },
          uniques: [{ columns: ['email'], name: 'T_email_key' }],
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['T']!.uniques).toEqual([{ columns: ['email'], name: 'T_email_key' }]);
  });

  it('converts indexes with unique: false', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            email: col({ nativeType: 'text' }),
          },
          indexes: [{ columns: ['email'], name: 'T_email_idx' }],
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['T']!.indexes).toEqual([
      { columns: ['email'], name: 'T_email_idx', unique: false },
    ]);
  });

  it('converts foreign keys (reshapes references)', () => {
    const storage: SqlStorage = {
      tables: {
        Post: table({
          columns: {
            authorId: col({ nativeType: 'text' }),
          },
          foreignKeys: [
            {
              columns: ['authorId'],
              references: { table: 'User', columns: ['id'] },
              name: 'Post_authorId_fkey',
              constraint: true,
              index: true,
            },
          ],
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['Post']!.foreignKeys).toEqual([
      {
        columns: ['authorId'],
        referencedTable: 'User',
        referencedColumns: ['id'],
        name: 'Post_authorId_fkey',
      },
    ]);
  });

  it('converts multiple tables', () => {
    const storage: SqlStorage = {
      tables: {
        User: table({
          columns: { id: col({ nativeType: 'text' }) },
        }),
        Post: table({
          columns: { id: col({ nativeType: 'text' }) },
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(Object.keys(result.tables)).toEqual(expect.arrayContaining(['User', 'Post']));
    expect(Object.keys(result.tables)).toHaveLength(2);
  });

  it('ignores SqlStorage.types (codec metadata)', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            embedding: col({ nativeType: 'vector', typeRef: 'Embedding' }),
          },
        }),
      },
      types: {
        Embedding: {
          codecId: 'pgvector/vector@1',
          nativeType: 'vector',
          typeParams: { dimensions: 1536 },
        },
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.extensions).toEqual([]);
    expect(result.tables['T']!.columns['embedding']!.nativeType).toBe('vector');
  });

  it('sets extensions to empty array', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: { id: col({ nativeType: 'text' }) },
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.extensions).toEqual([]);
  });

  it('handles unique constraints without names', () => {
    const storage: SqlStorage = {
      tables: {
        T: table({
          columns: {
            a: col({ nativeType: 'text' }),
            b: col({ nativeType: 'text' }),
          },
          uniques: [{ columns: ['a', 'b'] }],
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['T']!.uniques[0]).toEqual({ columns: ['a', 'b'] });
  });

  it('handles foreign keys without names', () => {
    const storage: SqlStorage = {
      tables: {
        Post: table({
          columns: { authorId: col({ nativeType: 'text' }) },
          foreignKeys: [
            {
              columns: ['authorId'],
              references: { table: 'User', columns: ['id'] },
              constraint: true,
              index: true,
            },
          ],
        }),
      },
    };

    const result = contractToSchemaIR(storage, undefined, testRenderer);
    expect(result.tables['Post']!.foreignKeys[0]).toEqual({
      columns: ['authorId'],
      referencedTable: 'User',
      referencedColumns: ['id'],
    });
  });
});

describe('detectDestructiveChanges', () => {
  it('returns empty for null from', () => {
    const to: SqlStorage = {
      tables: { T: table({ columns: { a: col({ nativeType: 'text' }) } }) },
    };
    expect(detectDestructiveChanges(null, to)).toEqual([]);
  });

  it('returns empty when no removals', () => {
    const storage: SqlStorage = {
      tables: { T: table({ columns: { a: col({ nativeType: 'text' }) } }) },
    };
    expect(detectDestructiveChanges(storage, storage)).toEqual([]);
  });

  it('returns empty when columns are added', () => {
    const from: SqlStorage = {
      tables: { T: table({ columns: { a: col({ nativeType: 'text' }) } }) },
    };
    const to: SqlStorage = {
      tables: {
        T: table({ columns: { a: col({ nativeType: 'text' }), b: col({ nativeType: 'text' }) } }),
      },
    };
    expect(detectDestructiveChanges(from, to)).toEqual([]);
  });

  it('detects removed column', () => {
    const from: SqlStorage = {
      tables: {
        T: table({ columns: { a: col({ nativeType: 'text' }), b: col({ nativeType: 'text' }) } }),
      },
    };
    const to: SqlStorage = {
      tables: { T: table({ columns: { a: col({ nativeType: 'text' }) } }) },
    };

    const conflicts = detectDestructiveChanges(from, to);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      kind: 'columnRemoved',
      summary: 'Column "T"."b" was removed',
    });
  });

  it('detects removed table', () => {
    const from: SqlStorage = {
      tables: {
        A: table({ columns: { id: col({ nativeType: 'text' }) } }),
        B: table({ columns: { id: col({ nativeType: 'text' }) } }),
      },
    };
    const to: SqlStorage = {
      tables: { A: table({ columns: { id: col({ nativeType: 'text' }) } }) },
    };

    const conflicts = detectDestructiveChanges(from, to);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      kind: 'tableRemoved',
      summary: 'Table "B" was removed',
    });
  });

  it('does not report columns of a removed table individually', () => {
    const from: SqlStorage = {
      tables: {
        T: table({
          columns: { a: col({ nativeType: 'text' }), b: col({ nativeType: 'text' }) },
        }),
      },
    };
    const to: SqlStorage = { tables: {} };

    const conflicts = detectDestructiveChanges(from, to);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('tableRemoved');
  });

  it('detects multiple removals', () => {
    const from: SqlStorage = {
      tables: {
        A: table({
          columns: { id: col({ nativeType: 'text' }), name: col({ nativeType: 'text' }) },
        }),
        B: table({ columns: { id: col({ nativeType: 'text' }) } }),
      },
    };
    const to: SqlStorage = {
      tables: {
        A: table({ columns: { id: col({ nativeType: 'text' }) } }),
      },
    };

    const conflicts = detectDestructiveChanges(from, to);
    expect(conflicts).toHaveLength(2);
    const kinds = conflicts.map((c) => c.kind);
    expect(kinds).toContain('columnRemoved');
    expect(kinds).toContain('tableRemoved');
  });

  it('detects removed table with prototype-name identifier', () => {
    const from: SqlStorage = {
      tables: {
        toString: table({ columns: { id: col({ nativeType: 'text' }) } }),
      },
    };
    const to: SqlStorage = { tables: {} };

    const conflicts = detectDestructiveChanges(from, to);
    expect(conflicts).toEqual([
      {
        kind: 'tableRemoved',
        summary: 'Table "toString" was removed',
      },
    ]);
  });

  it('detects removed column with prototype-name identifier', () => {
    const from: SqlStorage = {
      tables: {
        T: table({
          columns: {
            toString: col({ nativeType: 'text' }),
          },
        }),
      },
    };
    const to: SqlStorage = {
      tables: {
        T: table({ columns: {} }),
      },
    };

    const conflicts = detectDestructiveChanges(from, to);
    expect(conflicts).toEqual([
      {
        kind: 'columnRemoved',
        summary: 'Column "T"."toString" was removed',
      },
    ]);
  });
});
