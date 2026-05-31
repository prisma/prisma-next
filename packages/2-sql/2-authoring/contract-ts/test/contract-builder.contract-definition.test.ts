import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type { TargetPackRef } from '@prisma-next/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { buildSqlContractFromDefinition } from '../src/contract-builder';
import { modelsOf } from './contract-test-helpers';
import { crossRef, documentScopedTypes } from './cross-ref-helpers';
import { unboundTables } from './unbound-tables';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

describe('shared contract definition lowering', () => {
  it('builds SQL contract IR from contract model nodes', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      storageTypes: {
        Role: {
          kind: 'codec-instance',
          codecId: 'pg/enum@1',
          nativeType: 'role',
          typeParams: { values: ['USER', 'ADMIN'] },
        },
      },
      models: [
        {
          modelName: 'User',
          tableName: 'app_user',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: {
                codecId: 'sql/char@1',
                nativeType: 'character',
                typeParams: { length: 36 },
              },
              nullable: false,
              executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv4' } },
            },
            {
              fieldName: 'role',
              columnName: 'role',
              descriptor: {
                codecId: 'pg/enum@1',
                nativeType: 'role',
                typeRef: 'Role',
              },
              nullable: false,
            },
          ],
          id: {
            columns: ['id'],
            name: 'app_user_pkey',
          },
          relations: [
            {
              fieldName: 'posts',
              toModel: 'Post',
              toTable: 'blog_post',
              cardinality: '1:N',
              on: {
                parentTable: 'app_user',
                parentColumns: ['id'],
                childTable: 'blog_post',
                childColumns: ['author_id'],
              },
            },
          ],
        },
        {
          modelName: 'Post',
          tableName: 'blog_post',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: {
                codecId: 'pg/int4@1',
                nativeType: 'int4',
              },
              nullable: false,
            },
            {
              fieldName: 'authorId',
              columnName: 'author_id',
              descriptor: {
                codecId: 'sql/char@1',
                nativeType: 'character',
                typeParams: { length: 36 },
              },
              nullable: false,
            },
          ],
          id: {
            columns: ['id'],
            name: 'blog_post_pkey',
          },
          foreignKeys: [
            {
              columns: ['author_id'],
              references: {
                model: 'User',
                table: 'app_user',
                columns: ['id'],
              },
              name: 'blog_post_author_id_fkey',
            },
          ],
          relations: [
            {
              fieldName: 'author',
              toModel: 'User',
              toTable: 'app_user',
              cardinality: 'N:1',
              on: {
                parentTable: 'blog_post',
                parentColumns: ['author_id'],
                childTable: 'app_user',
                childColumns: ['id'],
              },
            },
          ],
        },
      ],
    });

    const models = modelsOf(contract) as Record<
      string,
      | {
          readonly storage: { readonly fields: Record<string, unknown> };
          readonly fields: Record<string, unknown>;
          readonly relations: Record<string, unknown>;
        }
      | undefined
    >;

    expect(documentScopedTypes(contract)?.['Role']).toEqual({
      kind: 'codec-instance',
      codecId: 'pg/enum@1',
      nativeType: 'role',
      typeParams: { values: ['USER', 'ADMIN'] },
    });
    expect(unboundTables(contract.storage)['app_user']?.primaryKey).toEqual({
      columns: ['id'],
      name: 'app_user_pkey',
    });
    expect(unboundTables(contract.storage)['blog_post']?.foreignKeys).toEqual([
      {
        source: {
          namespaceId: UNBOUND_NAMESPACE_ID,
          tableName: 'blog_post',
          columns: ['author_id'],
        },
        target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'app_user', columns: ['id'] },
        name: 'blog_post_author_id_fkey',
        constraint: true,
        index: true,
      },
    ]);
    expect(models['User']?.relations['posts']).toEqual({
      to: crossRef('Post'),
      cardinality: '1:N',
      on: {
        localFields: ['id'],
        targetFields: ['authorId'],
      },
    });
    expect(models['Post']?.storage.fields['authorId']).toEqual({
      column: 'author_id',
    });
  });

  it('encodes literal defaults through codecLookup during storage lowering', () => {
    const codecLookup: CodecLookup = {
      get: (id) => {
        if (id !== 'pg/timestamptz@1') {
          return undefined;
        }

        return {
          id,
          encode: async (value: unknown) => value,
          decode: async (wire: unknown) => wire,
          encodeJson: (value: unknown) =>
            value instanceof Date ? value.toISOString() : (value as string),
          decodeJson: (json: unknown) => new Date(json as string),
        };
      },
      targetTypesFor: (id) => (id === 'pg/timestamptz@1' ? ['timestamptz'] : undefined),
      metaFor: () => undefined,
      renderOutputTypeFor: () => undefined,
    };

    const contract = buildSqlContractFromDefinition(
      {
        target: postgresTargetPack,
        models: [
          {
            modelName: 'Event',
            tableName: 'event',
            fields: [
              {
                fieldName: 'scheduledAt',
                columnName: 'scheduled_at',
                descriptor: {
                  codecId: 'pg/timestamptz@1',
                  nativeType: 'timestamptz',
                },
                nullable: false,
                default: {
                  kind: 'literal',
                  value: new Date('2025-01-01T00:00:00.000Z'),
                },
              },
            ],
          },
        ],
      },
      codecLookup,
    );

    expect(unboundTables(contract.storage)['event']?.columns['scheduled_at']?.default).toEqual({
      kind: 'literal',
      value: '2025-01-01T00:00:00.000Z',
    });
  });

  it('builds phase-specific execution defaults', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      models: [
        {
          modelName: 'User',
          tableName: 'app_user',
          fields: [
            {
              fieldName: 'updatedAt',
              columnName: 'updated_at',
              descriptor: {
                codecId: 'pg/timestamptz@1',
                nativeType: 'timestamptz',
              },
              nullable: false,
              executionDefaults: {
                onCreate: { kind: 'generator', id: 'timestampNow' },
                onUpdate: { kind: 'generator', id: 'timestampNow' },
              },
            },
          ],
        },
      ],
    });

    expect(contract.execution?.mutations.defaults).toEqual([
      {
        ref: { table: 'app_user', column: 'updated_at' },
        onCreate: { kind: 'generator', id: 'timestampNow' },
        onUpdate: { kind: 'generator', id: 'timestampNow' },
      },
    ]);
  });

  it('rejects generated fields that also declare storage defaults', () => {
    expect(() =>
      buildSqlContractFromDefinition({
        target: postgresTargetPack,
        models: [
          {
            modelName: 'User',
            tableName: 'app_user',
            fields: [
              {
                fieldName: 'id',
                columnName: 'id',
                descriptor: {
                  codecId: 'pg/text@1',
                  nativeType: 'text',
                },
                nullable: false,
                default: {
                  kind: 'function',
                  expression: 'gen_random_uuid()',
                },
                executionDefaults: {
                  onCreate: {
                    kind: 'generator',
                    id: 'uuidv4',
                  },
                },
              },
            ],
          },
        ],
      }),
    ).toThrow('Field "User.id" cannot define both default and executionDefaults.');
  });

  it('rejects generated fields that are still marked nullable', () => {
    expect(() =>
      buildSqlContractFromDefinition({
        target: postgresTargetPack,
        models: [
          {
            modelName: 'User',
            tableName: 'app_user',
            fields: [
              {
                fieldName: 'id',
                columnName: 'id',
                descriptor: {
                  codecId: 'pg/text@1',
                  nativeType: 'text',
                },
                nullable: true,
                executionDefaults: {
                  onCreate: {
                    kind: 'generator',
                    id: 'uuidv4',
                  },
                },
              },
            ],
          },
        ],
      }),
    ).toThrow('Field "User.id" cannot be nullable when executionDefaults are present.');
  });

  it('rejects nullable identity fields', () => {
    expect(() =>
      buildSqlContractFromDefinition({
        target: postgresTargetPack,
        models: [
          {
            modelName: 'User',
            tableName: 'app_user',
            fields: [
              {
                fieldName: 'id',
                columnName: 'id',
                descriptor: {
                  codecId: 'pg/int4@1',
                  nativeType: 'int4',
                },
                nullable: true,
              },
            ],
            id: {
              columns: ['id'],
            },
          },
        ],
      }),
    ).toThrow(
      /Contract semantic validation failed:.*primary key column "id".*primary key columns must be NOT NULL/,
    );
  });

  it('routes namespaceTypes enums to storage.namespaces[nsId].enum', () => {
    const contract = buildSqlContractFromDefinition({
      target: postgresTargetPack,
      namespaceTypes: {
        auth: {
          user_type: {
            kind: 'postgres-enum',
            name: 'user_type',
            nativeType: 'user_type',
            values: ['admin', 'user'],
            codecId: 'pg/enum@1',
          },
        },
      },
      models: [
        {
          modelName: 'User',
          tableName: 'users',
          namespaceId: 'auth',
          fields: [
            {
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text' },
              nullable: false,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
    });

    const nsStorage = contract.storage as unknown as {
      namespaces: Record<string, { enum?: Record<string, unknown> }>;
    };
    expect(nsStorage.namespaces['auth']?.enum).toMatchObject({
      user_type: { kind: 'postgres-enum', values: ['admin', 'user'] },
    });
    expect(nsStorage.namespaces['public']?.enum).toBeUndefined();
  });
});
