import type { TargetPackRef } from '@prisma-next/contract/framework-components';
import { describe, expect, it } from 'vitest';
import { buildSqlContractFromSemanticDefinition } from '../src/contract-builder';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

describe('shared semantic contract lowering', () => {
  it('builds SQL contract IR from semantic model nodes', () => {
    const contract = buildSqlContractFromSemanticDefinition({
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
        targetFields: ['author_id'],
      },
    });
    expect(models['Post']?.storage.fields['authorId']).toEqual({
      column: 'author_id',
    });
  });

  it('rejects generated fields that also declare storage defaults', () => {
    expect(() =>
      buildSqlContractFromSemanticDefinition({
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
      buildSqlContractFromSemanticDefinition({
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
      buildSqlContractFromSemanticDefinition({
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
