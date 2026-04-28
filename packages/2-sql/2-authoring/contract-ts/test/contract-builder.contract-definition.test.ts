import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type { TargetPackRef } from '@prisma-next/framework-components/components';
import { describe, expect, it } from 'vitest';
import { buildSqlContractFromDefinition } from '../src/contract-builder';

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
              executionDefault: { kind: 'generator', id: 'uuidv4' },
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

    const storage = contract.storage as {
      readonly types?: Record<string, unknown>;
      readonly tables?: Record<
        string,
        { readonly primaryKey?: unknown; readonly foreignKeys?: unknown }
      >;
    };
    const models = contract.models as Record<
      string,
      | {
          readonly storage: { readonly fields: Record<string, unknown> };
          readonly fields: Record<string, unknown>;
          readonly relations: Record<string, unknown>;
        }
      | undefined
    >;

    expect(storage['types']?.['Role']).toEqual({
      codecId: 'pg/enum@1',
      nativeType: 'role',
      typeParams: { values: ['USER', 'ADMIN'] },
    });
    expect(storage['tables']?.['app_user']?.primaryKey).toEqual({
      columns: ['id'],
      name: 'app_user_pkey',
    });
    expect(storage['tables']?.['blog_post']?.foreignKeys).toEqual([
      {
        columns: ['author_id'],
        references: {
          table: 'app_user',
          columns: ['id'],
        },
        name: 'blog_post_author_id_fkey',
        constraint: true,
        index: true,
      },
    ]);
    expect(models['User']?.relations['posts']).toEqual({
      to: 'Post',
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
          targetTypes: ['timestamptz'],
          traits: ['equality', 'order'] as const,
          encode: async (value: unknown) => value,
          decode: async (wire: unknown) => wire,
          encodeJson: (value: unknown) =>
            value instanceof Date ? value.toISOString() : (value as string),
          decodeJson: (json: unknown) => new Date(json as string),
        };
      },
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

    expect(contract.storage.tables['event']?.columns['scheduled_at']?.default).toEqual({
      kind: 'literal',
      value: '2025-01-01T00:00:00.000Z',
    });
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
                executionDefault: {
                  kind: 'generator',
                  id: 'uuidv4',
                },
              },
            ],
          },
        ],
      }),
    ).toThrow('Field "User.id" cannot define both default and executionDefault.');
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
                executionDefault: {
                  kind: 'generator',
                  id: 'uuidv4',
                },
              },
            ],
          },
        ],
      }),
    ).toThrow('Field "User.id" cannot be nullable when executionDefault is present.');
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
    ).toThrow('Model "User" uses nullable field "id" in its identity.');
  });
});
