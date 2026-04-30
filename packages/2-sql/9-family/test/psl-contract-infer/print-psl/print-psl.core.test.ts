import { printPsl } from '@prisma-next/psl-printer';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { sqlSchemaIrToPslAst } from '../../../src/core/psl-contract-infer/sql-schema-ir-to-psl-ast';

function printPslFromSql(schemaIR: SqlSchemaIR): string {
  return printPsl(sqlSchemaIrToPslAst(schemaIR));
}

describe('printPsl', () => {
  it('empty schema', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {},
      dependencies: [],
    };
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.
      "
    `);
  });

  it('simple schema with single table', () => {
    const schemaIR: SqlSchemaIR = {
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
      },
      dependencies: [],
    };
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model User {
        id    Int     @id
        email String  @unique
        name  String?

        @@map("user")
      }
      "
    `);
  });

  it('table without primary key', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        audit_log: {
          name: 'audit_log',
          columns: {
            event: { name: 'event', nativeType: 'text', nullable: false },
            timestamp: {
              name: 'timestamp',
              nativeType: 'timestamptz',
              nullable: false,
            },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      // WARNING: This table has no primary key in the database
      model AuditLog {
        event     String
        timestamp DateTime

        @@map("audit_log")
      }
      "
    `);
  });

  it('composite primary key', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        order_item: {
          name: 'order_item',
          columns: {
            order_id: { name: 'order_id', nativeType: 'int4', nullable: false },
            product_id: {
              name: 'product_id',
              nativeType: 'int4',
              nullable: false,
            },
            quantity: { name: 'quantity', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['order_id', 'product_id'], name: 'order_item_pkey' },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// This file was introspected from the database. Do not edit manually.

      model OrderItem {
        orderId   Int @map("order_id")
        productId Int @map("product_id")
        quantity  Int

        @@id([orderId, productId], map: "order_item_pkey")
        @@map("order_item")
      }
      "
    `);
  });

  it('deterministic output: same input always produces same output', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        b_table: {
          name: 'b_table',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        a_table: {
          name: 'a_table',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };
    const result1 = printPslFromSql(schemaIR);
    const result2 = printPslFromSql(schemaIR);
    expect(result1).toBe(result2);
    expect(result1.indexOf('ATable')).toBeLessThan(result1.indexOf('BTable'));
  });
});
