import { printPsl } from '@prisma-next/psl-printer';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { sqlSchemaIrToPslAst } from '../../src/core/psl-contract-infer/sql-schema-ir-to-psl-ast';

function ir(partial: Partial<SqlSchemaIR> & Pick<SqlSchemaIR, 'tables'>): SqlSchemaIR {
  return {
    dependencies: [],
    ...partial,
  };
}

describe('sqlSchemaIrToPslAst', () => {
  it('produces a model for a single table with PK and unique', () => {
    const schemaIR = ir({
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            email: { name: 'email', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [{ columns: ['email'] }],
          indexes: [],
        },
      },
    });

    const ast = sqlSchemaIrToPslAst(schemaIR);
    expect(ast.kind).toBe('document');
    expect(ast.models).toHaveLength(1);
    const model = ast.models[0];
    expect(model?.name).toBe('User');
    const idField = model?.fields.find((f) => f.name === 'id');
    expect(idField?.attributes.some((a) => a.name === 'id')).toBe(true);
    const emailField = model?.fields.find((f) => f.name === 'email');
    expect(emailField?.attributes.some((a) => a.name === 'unique')).toBe(true);
  });

  it('infers relation fields from foreign keys', () => {
    const schemaIR = ir({
      tables: {
        user: {
          name: 'user',
          columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        post: {
          name: 'post',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['user_id'],
              referencedTable: 'user',
              referencedColumns: ['id'],
            },
          ],
          uniques: [],
          indexes: [],
        },
      },
    });

    const ast = sqlSchemaIrToPslAst(schemaIR);
    const userModel = ast.models.find((m) => m.name === 'User');
    const postModel = ast.models.find((m) => m.name === 'Post');
    const postsField = userModel?.fields.find((f) => f.name === 'posts');
    expect(postsField?.list).toBe(true);
    const userField = postModel?.fields.find((f) => f.name === 'user');
    expect(userField?.attributes.some((a) => a.name === 'relation')).toBe(true);
  });

  it('emits enum declarations and field references for pg/enum codec annotations', () => {
    const schemaIR = ir({
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            role: { name: 'role', nativeType: 'role_t', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      annotations: {
        pg: {
          storageTypes: {
            role_t: {
              codecId: 'pg/enum@1',
              nativeType: 'role_t',
              typeParams: { values: ['admin', 'user'] },
            },
          },
        },
      },
    });

    const ast = sqlSchemaIrToPslAst(schemaIR);
    expect(ast.enums.map((e) => e.name)).toEqual(['RoleT']);
    const enumModel = ast.models[0];
    const roleField = enumModel?.fields.find((f) => f.name === 'role');
    expect(roleField?.typeName).toBe('RoleT');
  });

  it('produces a @default(now()) attribute for raw now() defaults', () => {
    const schemaIR = ir({
      tables: {
        event: {
          name: 'event',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            ts: {
              name: 'ts',
              nativeType: 'timestamptz',
              nullable: false,
              default: 'now()',
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });

    const ast = sqlSchemaIrToPslAst(schemaIR);
    const tsField = ast.models[0]?.fields.find((f) => f.name === 'ts');
    const defaultAttr = tsField?.attributes.find((a) => a.name === 'default');
    expect(defaultAttr).toBeDefined();
    const arg = defaultAttr?.args[0];
    expect(arg && arg.kind === 'positional' ? arg.value : '').toContain('now()');
  });

  it('renders a representative two-table schema with FK relation deterministically', () => {
    const schemaIR = ir({
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            email: { name: 'email', nativeType: 'text', nullable: false },
            name: { name: 'name', nativeType: 'text', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [{ columns: ['email'] }],
          indexes: [],
        },
        post: {
          name: 'post',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            title: { name: 'title', nativeType: 'text', nullable: false },
            user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['user_id'],
              referencedTable: 'user',
              referencedColumns: ['id'],
            },
          ],
          uniques: [],
          indexes: [{ columns: ['user_id'], unique: false }],
        },
      },
    });

    const out = printPsl(sqlSchemaIrToPslAst(schemaIR));
    expect(out).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model User {
        id    Int     @id
        email String  @unique
        name  String?
        posts Post[]

        @@map("user")
      }

      model Post {
        id     Int    @id
        title  String
        userId Int    @map("user_id")
        user   User   @relation(fields: [userId], references: [id])

        @@index([userId])
        @@map("post")
      }
      "
    `);
  });
});
