import { flatPslModels } from '@prisma-next/framework-components/psl-ast';
import { printPsl } from '@prisma-next/psl-printer';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { inferPslAstFromFlat as sqlSchemaIrToPslAst } from './fixtures';

function ir(partial: Partial<SqlSchemaIR> & Pick<SqlSchemaIR, 'tables'>): SqlSchemaIR {
  return {
    ...partial,
  };
}

describe('inferPostgresPslContract', () => {
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
    expect(flatPslModels(ast)).toHaveLength(1);
    const model = flatPslModels(ast)[0];
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
    const userModel = flatPslModels(ast).find((m) => m.name === 'User');
    const postModel = flatPslModels(ast).find((m) => m.name === 'Post');
    const postsField = userModel?.fields.find((f) => f.name === 'posts');
    expect(postsField?.list).toBe(true);
    const userField = postModel?.fields.find((f) => f.name === 'user');
    expect(userField?.attributes.some((a) => a.name === 'relation')).toBe(true);
  });

  it('throws an actionable diagnostic when the schema contains native Postgres enum types', () => {
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
          nativeEnumTypeNames: ['role_t'],
        },
      },
    });

    expect(() => sqlSchemaIrToPslAst(schemaIR)).toThrow(
      /contract infer:.*native Postgres enum type.*role_t.*not adoptable/i,
    );
  });

  it('throws naming all native enum types when multiple are present', () => {
    const schemaIR = ir({
      tables: {
        applications: {
          name: 'applications',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            status: { name: 'status', nativeType: 'application_kind', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      annotations: {
        pg: {
          nativeEnumTypeNames: ['application_kind'],
        },
      },
    });

    expect(() => sqlSchemaIrToPslAst(schemaIR)).toThrow('application_kind');
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
    const tsField = flatPslModels(ast)[0]?.fields.find((f) => f.name === 'ts');
    const defaultAttr = tsField?.attributes.find((a) => a.name === 'default');
    expect(defaultAttr).toBeDefined();
    const arg = defaultAttr?.args[0];
    expect(arg && arg.kind === 'positional' ? arg.value : '').toContain('now()');
  });

  it('attaches a "no primary key" warning comment for tables without a primary key', () => {
    const schemaIR = ir({
      tables: {
        audit_log: {
          name: 'audit_log',
          columns: {
            event: { name: 'event', nativeType: 'text', nullable: false },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });

    const ast = sqlSchemaIrToPslAst(schemaIR);
    const auditLog = flatPslModels(ast).find((m) => m.name === 'AuditLog');
    expect(auditLog?.comment).toBe('// WARNING: This table has no primary key in the database');
  });

  it('omits the no-primary-key comment for tables with a primary key', () => {
    const schemaIR = ir({
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });

    const ast = sqlSchemaIrToPslAst(schemaIR);
    const user = flatPslModels(ast).find((m) => m.name === 'User');
    expect(user?.comment).toBeUndefined();
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
      "// use prisma-next
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma-next contract emit\`.

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
