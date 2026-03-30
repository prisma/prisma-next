import { describe, expect, it } from 'vitest';
import { validatePrintableSqlSchemaIR } from '../src/schema-validation';

describe('validatePrintableSqlSchemaIR', () => {
  it('validates a printable schema with defaults, annotations, and relations', () => {
    const schema = validatePrintableSqlSchemaIR({
      tables: {
        user: {
          name: 'user',
          columns: {
            id: {
              name: 'id',
              nativeType: 'int4',
              nullable: false,
              default: { kind: 'literal', value: 1 },
              annotations: { db: { column: 'id' } },
            },
            email: {
              name: 'email',
              nativeType: 'text',
              nullable: false,
              default: 'dbgenerated("lower(\'a\')")',
            },
            createdAt: {
              name: 'created_at',
              nativeType: 'timestamptz',
              nullable: false,
              default: { kind: 'function', expression: 'now()' },
            },
            nickname: {
              name: 'nickname',
              nativeType: 'text',
              nullable: true,
            },
          },
          primaryKey: {
            columns: ['id'],
          },
          foreignKeys: [
            {
              columns: ['id'],
              referencedTable: 'profile',
              referencedColumns: ['user_id'],
              onDelete: 'cascade',
            },
          ],
          uniques: [
            {
              columns: ['email'],
              name: 'user_email_key',
              annotations: { db: { unique: 'email' } },
            },
          ],
          indexes: [
            {
              columns: ['nickname'],
              unique: false,
            },
          ],
          annotations: { db: { table: 'user' } },
        },
      },
      dependencies: [{ id: 'pgcrypto' }],
      annotations: { db: { schema: 'public' } },
    });

    expect(schema).toEqual({
      tables: {
        user: {
          name: 'user',
          columns: {
            id: {
              name: 'id',
              nativeType: 'int4',
              nullable: false,
              default: { kind: 'literal', value: 1 },
              annotations: { db: { column: 'id' } },
            },
            email: {
              name: 'email',
              nativeType: 'text',
              nullable: false,
              default: 'dbgenerated("lower(\'a\')")',
            },
            createdAt: {
              name: 'created_at',
              nativeType: 'timestamptz',
              nullable: false,
              default: { kind: 'function', expression: 'now()' },
            },
            nickname: {
              name: 'nickname',
              nativeType: 'text',
              nullable: true,
            },
          },
          primaryKey: {
            columns: ['id'],
          },
          foreignKeys: [
            {
              columns: ['id'],
              referencedTable: 'profile',
              referencedColumns: ['user_id'],
              onDelete: 'cascade',
            },
          ],
          uniques: [
            {
              columns: ['email'],
              name: 'user_email_key',
              annotations: { db: { unique: 'email' } },
            },
          ],
          indexes: [
            {
              columns: ['nickname'],
              unique: false,
            },
          ],
          annotations: { db: { table: 'user' } },
        },
      },
      dependencies: [{ id: 'pgcrypto' }],
      annotations: { db: { schema: 'public' } },
    });
  });

  it('accepts omitted optional fields', () => {
    const schema = validatePrintableSqlSchemaIR({
      tables: {
        profile: {
          name: 'profile',
          columns: {
            userId: {
              name: 'user_id',
              nativeType: 'int4',
              nullable: false,
            },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    });

    expect(schema).toEqual({
      tables: {
        profile: {
          name: 'profile',
          columns: {
            userId: {
              name: 'user_id',
              nativeType: 'int4',
              nullable: false,
            },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    });
  });

  it('rejects non-object schemas', () => {
    expect(() => validatePrintableSqlSchemaIR([])).toThrow('schema must be an object');
  });

  it('rejects non-array collections', () => {
    expect(() =>
      validatePrintableSqlSchemaIR({
        tables: {
          user: {
            name: 'user',
            columns: {},
            foreignKeys: {},
            uniques: [],
            indexes: [],
          },
        },
        dependencies: [],
      }),
    ).toThrow('schema.tables.user.foreignKeys must be an array');
  });

  it('rejects non-string values in string fields', () => {
    expect(() =>
      validatePrintableSqlSchemaIR({
        tables: {
          user: {
            name: 'user',
            columns: {},
            foreignKeys: [],
            uniques: [],
            indexes: [],
          },
        },
        dependencies: [{ id: 1 }],
      }),
    ).toThrow('schema.dependencies[0].id must be a string');
  });

  it('rejects non-boolean nullable flags', () => {
    expect(() =>
      validatePrintableSqlSchemaIR({
        tables: {
          user: {
            name: 'user',
            columns: {
              id: {
                name: 'id',
                nativeType: 'int4',
                nullable: 'no',
              },
            },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          },
        },
        dependencies: [],
      }),
    ).toThrow('schema.tables.user.columns.id.nullable must be a boolean');
  });

  it('rejects literal defaults without a value', () => {
    expect(() =>
      validatePrintableSqlSchemaIR({
        tables: {
          user: {
            name: 'user',
            columns: {
              id: {
                name: 'id',
                nativeType: 'int4',
                nullable: false,
                default: { kind: 'literal' },
              },
            },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          },
        },
        dependencies: [],
      }),
    ).toThrow('schema.tables.user.columns.id.default.value must be present for literal defaults');
  });

  it('rejects unsupported default kinds', () => {
    expect(() =>
      validatePrintableSqlSchemaIR({
        tables: {
          user: {
            name: 'user',
            columns: {
              id: {
                name: 'id',
                nativeType: 'int4',
                nullable: false,
                default: { kind: 'sequence' },
              },
            },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          },
        },
        dependencies: [],
      }),
    ).toThrow('schema.tables.user.columns.id.default.kind must be "literal" or "function"');
  });

  it('rejects unsupported referential actions', () => {
    expect(() =>
      validatePrintableSqlSchemaIR({
        tables: {
          user: {
            name: 'user',
            columns: {},
            foreignKeys: [
              {
                columns: ['profileId'],
                referencedTable: 'profile',
                referencedColumns: ['id'],
                onUpdate: 'archive',
              },
            ],
            uniques: [],
            indexes: [],
          },
        },
        dependencies: [],
      }),
    ).toThrow(
      'schema.tables.user.foreignKeys[0].onUpdate must be one of "noAction", "restrict", "cascade", "setNull", "setDefault"',
    );
  });
});
